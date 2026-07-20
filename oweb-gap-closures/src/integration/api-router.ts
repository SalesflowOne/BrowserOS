/**
 * OWeb integration API router — mount all gap-closure endpoints.
 *
 * Usage (Vercel/Next/Hono):
 *   export const GET = (req) => integration.handle(req);
 *   export const POST = (req) => integration.handle(req);
 */
import { handleChannelWebhook } from "../channels/channel-hub.server.js";
import { setTelegramWebhook, buildTelegramWebhookPath } from "../channels/telegram-channel.server.js";
import { buildWhatsAppWebhookPath } from "../channels/whatsapp-twilio-channel.server.js";
import { handleOrgWebhook } from "../webhooks/org-webhooks.server.js";
import { handleRegistryWebhook } from "../webhooks/webhook-registry.server.js";
import { createCronService } from "../scheduler/cron-lite.server.js";
import { OPENCLAW_GAP_MARKETPLACE_TOOLKITS, getMissingOpenClawMarketplaceSlugs } from "../marketplace/composio-additions.js";
import type { ChannelConfigStore } from "./channel-config-store.js";
import type { OwebIntegrationDeps } from "./types.js";
import {
  handleTwilioVoiceStatusWebhook,
  handleTwilioVoiceTwimlWebhook,
  buildTwilioVoiceWebhookPaths,
} from "./twilio-voice-webhook.js";
import { handleVercelCronRequest } from "./cron-vercel.js";
import type { TwilioVoiceConfig } from "../mcp/twilio-voice.server.js";

export type CreateOwebIntegrationOptions = OwebIntegrationDeps & {
  channelStore?: ChannelConfigStore;
};

export function createOwebIntegration(opts: CreateOwebIntegrationOptions) {
  const cron = createCronService(async ({ orgId, threadKey, message }) => {
    await opts.chatRunner({
      orgId,
      threadKey,
      inbound: {
        channel: "webhook",
        externalThreadId: threadKey,
        externalUserId: "cron",
        externalMessageId: `cron_${Date.now()}`,
        text: message,
      },
    });
  });

  const getConfig = opts.channelStore
    ? (orgId: string) => opts.channelStore!.get(orgId)
    : opts.getOrgConfig;

  async function resolveTwilioVoice(orgId: string): Promise<TwilioVoiceConfig | null> {
    if (typeof opts.twilioVoice === "function") {
      return opts.twilioVoice(orgId);
    }
    if (opts.twilioVoice) return opts.twilioVoice;
    const org = await getConfig(orgId);
    return org?.twilioVoice ?? null;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Channels ---
    if (path === "/api/channels/telegram/webhook") {
      const orgId = url.searchParams.get("org");
      if (!orgId) return new Response("Missing org", { status: 400 });
      return handleChannelWebhook(request, "telegram", orgId, {
        getConfig,
        chatRunner: opts.chatRunner,
      });
    }

    if (path === "/api/channels/whatsapp/webhook") {
      const orgId = url.searchParams.get("org");
      if (!orgId) return new Response("Missing org", { status: 400 });
      return handleChannelWebhook(request, "whatsapp", orgId, {
        getConfig,
        chatRunner: opts.chatRunner,
      });
    }

    // --- Channel setup API ---
    if (path === "/api/channels/whatsapp/setup" && request.method === "POST") {
      return handleWhatsAppSetup(request, opts);
    }

    if (path === "/api/channels/telegram/setup" && request.method === "POST") {
      return handleTelegramSetup(request, opts, getConfig);
    }

    if (path === "/api/channels/status" && request.method === "GET") {
      const orgId = url.searchParams.get("org");
      if (!orgId) return new Response("Missing org", { status: 400 });
      const cfg = await getConfig(orgId);
      return Response.json({
        telegram: Boolean(cfg?.telegram),
        whatsapp: Boolean(cfg?.whatsapp),
        routes: {
          telegram: `${opts.publicBaseUrl}${buildTelegramWebhookPath(orgId)}`,
          whatsapp: `${opts.publicBaseUrl}${buildWhatsAppWebhookPath(orgId)}`,
        },
      });
    }

    // --- Org webhooks ---
    const orgWebhookMatch = path.match(/^\/api\/webhooks\/org\/([^/]+)\/([^/]+)$/);
    if (orgWebhookMatch) {
      const [, orgId, routeId] = orgWebhookMatch;
      if (routeId === "default") {
        const org = await getConfig(orgId!);
        const secret = org?.webhookRoutes?.[0]?.secret;
        if (!secret) return new Response("Not configured", { status: 404 });
        return handleOrgWebhook(request, {
          orgId: orgId!,
          secret,
          chatRunner: async ({ orgId, threadKey, message, metadata }) => {
            await opts.chatRunner({
              orgId,
              threadKey,
              inbound: {
                channel: "webhook",
                externalThreadId: threadKey,
                externalUserId: "webhook",
                externalMessageId: `wh_${Date.now()}`,
                text: message,
                raw: metadata,
              },
            });
          },
        });
      }
      return handleRegistryWebhook(request, orgId!, routeId!, {
        getRoute: opts.getWebhookRoute,
        chatRunner: async ({ orgId, threadKey, message, metadata }) => {
          await opts.chatRunner({
            orgId,
            threadKey,
            inbound: {
              channel: "webhook",
              externalThreadId: threadKey,
              externalUserId: "webhook",
              externalMessageId: `wh_${Date.now()}`,
              text: message,
              raw: metadata,
            },
          });
        },
      });
    }

    // --- Twilio Voice ---
    if (path === "/api/voice/twilio/status") {
      const orgId = url.searchParams.get("org");
      if (!orgId) return new Response("Missing org", { status: 400 });
      const voiceCfg = await resolveTwilioVoice(orgId);
      if (!voiceCfg) return new Response("Voice not configured", { status: 404 });
      return handleTwilioVoiceStatusWebhook(request, {
        config: voiceCfg,
        getWebhookUrl: (req) => new URL(req.url).href,
      });
    }

    if (path === "/api/voice/twilio/twiml") {
      const orgId = url.searchParams.get("org");
      if (!orgId) return new Response("Missing org", { status: 400 });
      const voiceCfg = await resolveTwilioVoice(orgId);
      if (!voiceCfg) return new Response("Voice not configured", { status: 404 });
      return handleTwilioVoiceTwimlWebhook(request, {
        config: voiceCfg,
        getWebhookUrl: (req) => new URL(req.url).href,
      });
    }

    // --- Cron ---
    if (path === "/api/cron/oweb-jobs") {
      return handleVercelCronRequest(request, { cronSecret: opts.cronSecret, cron });
    }

    // --- Marketplace patch info ---
    if (path === "/api/integrations/openclaw-marketplace" && request.method === "GET") {
      const existing = new Set(url.searchParams.get("existing")?.split(",") ?? []);
      return Response.json({
        additions: OPENCLAW_GAP_MARKETPLACE_TOOLKITS,
        missing: getMissingOpenClawMarketplaceSlugs(existing),
      });
    }

    return new Response("Not found", { status: 404 });
  }

  return {
    handle,
    cron,
    routes: {
      telegramWebhook: buildTelegramWebhookPath("{orgId}"),
      whatsappWebhook: buildWhatsAppWebhookPath("{orgId}"),
      cron: "/api/cron/oweb-jobs",
      voice: buildTwilioVoiceWebhookPaths("{orgId}"),
    },
  };
}

async function handleTelegramSetup(
  request: Request,
  opts: CreateOwebIntegrationOptions,
  getConfig: (orgId: string) => Promise<import("./types.js").OrgIntegrationConfig | null>,
): Promise<Response> {
  const body = (await request.json()) as {
    orgId: string;
    botToken: string;
    webhookSecret: string;
    dmOnly?: boolean;
  };

  if (!body.orgId || !body.botToken || !body.webhookSecret) {
    return Response.json({ error: "orgId, botToken, webhookSecret required" }, { status: 400 });
  }

  if (opts.channelStore) {
    await opts.channelStore.upsertTelegram(body.orgId, {
      botToken: body.botToken,
      webhookSecret: body.webhookSecret,
      dmOnly: body.dmOnly,
    });
  }

  const webhookUrl = `${opts.publicBaseUrl}${buildTelegramWebhookPath(body.orgId)}`;
  await setTelegramWebhook(body.botToken, {
    url: webhookUrl,
    secret_token: body.webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  const cfg = await getConfig(body.orgId);
  return Response.json({
    ok: true,
    webhookUrl,
    telegram: Boolean(cfg?.telegram ?? opts.channelStore),
  });
}

async function handleWhatsAppSetup(
  request: Request,
  opts: CreateOwebIntegrationOptions,
): Promise<Response> {
  const body = (await request.json()) as {
    orgId: string;
    accountSid: string;
    authToken: string;
    fromWhatsApp: string;
  };

  if (!body.orgId || !body.accountSid || !body.authToken || !body.fromWhatsApp) {
    return Response.json(
      { error: "orgId, accountSid, authToken, fromWhatsApp required" },
      { status: 400 },
    );
  }

  if (opts.channelStore) {
    await opts.channelStore.upsertWhatsApp(body.orgId, {
      accountSid: body.accountSid,
      authToken: body.authToken,
      fromWhatsApp: body.fromWhatsApp,
    });
  }

  const webhookUrl = `${opts.publicBaseUrl}${buildWhatsAppWebhookPath(body.orgId)}`;
  return Response.json({
    ok: true,
    webhookUrl,
    note: "Configure this URL in Twilio Console → WhatsApp sandbox / sender webhook",
  });
}
