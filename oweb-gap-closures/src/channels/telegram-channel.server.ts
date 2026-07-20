/**
 * Telegram channel webhook ingress + outbound for OWeb.
 *
 * Wire to: POST /api/channels/telegram/webhook?org=<orgId>
 * Store bot token + webhook secret in ao_vault_credentials or org channel config.
 */
import { timingSafeEqual } from "node:crypto";

import type {
  ChannelInboundMessage,
  ChannelOutboundMessage,
  TelegramChannelConfig,
  TelegramWebhookDeps,
} from "./channel-types.js";
import {
  extractTelegramMessage,
  sendTelegramMessage,
  splitTelegramText,
  telegramThreadKey,
  type TelegramMessage,
  type TelegramUpdate,
} from "./telegram-api.js";

const MAX_BODY_BYTES = 1024 * 1024;

export function verifyTelegramWebhookSecret(
  request: Request,
  expectedSecret: string,
): boolean {
  const header = request.headers.get("x-telegram-bot-api-secret-token");
  if (!header || !expectedSecret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeTelegramInbound(message: TelegramMessage): ChannelInboundMessage {
  const chatId = message.chat.id;
  const threadId = message.message_thread_id;
  return {
    channel: "telegram",
    externalThreadId: telegramThreadKey(chatId, threadId),
    externalUserId: String(message.from?.id ?? chatId),
    externalMessageId: String(message.message_id),
    text: message.text ?? "",
    displayName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || undefined,
    username: message.from?.username,
    replyToMessageId: message.reply_to_message
      ? String(message.reply_to_message.message_id)
      : undefined,
    raw: message,
  };
}

export function shouldProcessTelegramMessage(
  message: TelegramMessage,
  config: TelegramChannelConfig,
): boolean {
  if (!message.text?.trim()) return false;
  if (config.dmOnly && message.chat.type !== "private") return false;
  if (message.from?.is_bot) return false;
  return true;
}

export async function sendTelegramOutbound(
  config: TelegramChannelConfig,
  outbound: ChannelOutboundMessage,
): Promise<void> {
  const [chatId, threadPart] = outbound.externalThreadId.split(":thread:");
  const messageThreadId = threadPart ? Number(threadPart) : undefined;
  const replyId = outbound.replyToMessageId
    ? Number(outbound.replyToMessageId)
    : undefined;

  for (const chunk of splitTelegramText(outbound.text)) {
    await sendTelegramMessage(config.botToken, {
      chat_id: chatId,
      text: chunk,
      parse_mode: outbound.parseMode,
      reply_to_message_id: replyId,
      message_thread_id: messageThreadId,
    });
  }
}

export async function handleTelegramWebhook(
  request: Request,
  deps: TelegramWebhookDeps,
): Promise<Response> {
  const { config, chatRunner } = deps;

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!verifyTelegramWebhookSecret(request, config.webhookSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = extractTelegramMessage(update);
  if (!message || !shouldProcessTelegramMessage(message, config)) {
    return new Response("OK");
  }

  const inbound = normalizeTelegramInbound(message);
  const threadKey =
    deps.resolveThreadKey?.(String(message.chat.id), message.message_thread_id) ??
    `telegram:${config.orgId}:${inbound.externalThreadId}`;

  // Process async — Telegram expects fast 200 OK
  void (async () => {
    try {
      const result = await chatRunner({
        orgId: config.orgId,
        threadKey,
        inbound,
      });
      if (!result.skipOutbound && result.replyText.trim()) {
        await sendTelegramOutbound(config, {
          externalThreadId: inbound.externalThreadId,
          text: result.replyText,
          replyToMessageId: inbound.externalMessageId,
        });
      }
    } catch (err) {
      console.error("[telegram-channel] chat runner failed", err);
      try {
        await sendTelegramOutbound(config, {
          externalThreadId: inbound.externalThreadId,
          text: "Sorry, something went wrong processing your message.",
        });
      } catch {
        /* best effort */
      }
    }
  })();

  return new Response("OK");
}

/** Build webhook URL for an org (mount on your API router). */
export function buildTelegramWebhookPath(orgId: string): string {
  return `/api/channels/telegram/webhook?org=${encodeURIComponent(orgId)}`;
}
