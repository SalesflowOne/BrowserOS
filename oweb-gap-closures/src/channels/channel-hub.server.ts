/**
 * Unified channel hub — route webhooks to the right handler by channel + org.
 */
import type { ChatRunner } from "./channel-types.js";
import { handleTelegramWebhook, type TelegramChannelConfig } from "./telegram-channel.server.js";
import {
  handleWhatsAppTwilioWebhook,
  type TwilioWhatsAppConfig,
} from "./whatsapp-twilio-channel.server.js";

export type ChannelHubConfig = {
  orgId: string;
  telegram?: TelegramChannelConfig;
  whatsapp?: TwilioWhatsAppConfig;
};

export type ChannelHubDeps = {
  getConfig: (orgId: string) => Promise<ChannelHubConfig | null>;
  chatRunner: ChatRunner;
};

export async function handleChannelWebhook(
  request: Request,
  channel: "telegram" | "whatsapp",
  orgId: string,
  deps: ChannelHubDeps,
): Promise<Response> {
  const config = await deps.getConfig(orgId);
  if (!config || config.orgId !== orgId) {
    return new Response("Org not found", { status: 404 });
  }

  switch (channel) {
    case "telegram": {
      if (!config.telegram) {
        return new Response("Telegram not configured", { status: 404 });
      }
      return handleTelegramWebhook(request, {
        config: config.telegram,
        chatRunner: deps.chatRunner,
      });
    }
    case "whatsapp": {
      if (!config.whatsapp) {
        return new Response("WhatsApp not configured", { status: 404 });
      }
      return handleWhatsAppTwilioWebhook(request, {
        config: config.whatsapp,
        chatRunner: deps.chatRunner,
      });
    }
    default:
      return new Response("Unknown channel", { status: 400 });
  }
}

export function buildChannelWebhookRoutes(basePath = "/api/channels"): Record<string, string> {
  return {
    telegram: `${basePath}/telegram/webhook?org={orgId}`,
    whatsapp: `${basePath}/whatsapp/webhook?org={orgId}`,
  };
}
