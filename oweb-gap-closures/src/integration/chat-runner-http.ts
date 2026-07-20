/**
 * HTTP chat runner — POST to OWeb lovable-chat or internal agent endpoint.
 * Keeps lovable-chat.ts unchanged; calls it via HTTP with service auth.
 */
import type { ChannelInboundMessage, ChatRunner, ChatRunnerResult } from "../channels/channel-types.js";

export type HttpChatRunnerConfig = {
  /** e.g. https://oweb.one/api/internal/channel-chat */
  endpoint: string;
  /** Service bearer token */
  apiKey: string;
  /** Optional: map thread to existing conversation */
  mapThreadKey?: (threadKey: string) => Record<string, string>;
};

export function createHttpChatRunner(config: HttpChatRunnerConfig): ChatRunner {
  return async ({ orgId, threadKey, inbound }) => {
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "X-OWeb-Org-Id": orgId,
      },
      body: JSON.stringify({
        orgId,
        threadKey,
        message: inbound.text,
        channel: inbound.channel,
        externalThreadId: inbound.externalThreadId,
        externalUserId: inbound.externalUserId,
        externalMessageId: inbound.externalMessageId,
        displayName: inbound.displayName,
        ...config.mapThreadKey?.(threadKey),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chat runner HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { reply?: string; replyText?: string; skipOutbound?: boolean };
    return {
      replyText: json.replyText ?? json.reply ?? "",
      skipOutbound: json.skipOutbound,
    } satisfies ChatRunnerResult;
  };
}

/** In-process runner for tests and local dev */
export function createEchoChatRunner(
  handler?: (req: {
    orgId: string;
    threadKey: string;
    inbound: ChannelInboundMessage;
  }) => Promise<ChatRunnerResult>,
): ChatRunner {
  return async (req) => {
    if (handler) return handler(req);
    return { replyText: `Echo: ${req.inbound.text}` };
  };
}
