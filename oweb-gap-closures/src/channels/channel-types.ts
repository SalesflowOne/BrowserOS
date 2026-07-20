/** Shared channel types for OWeb messaging integrations. */

export type ChannelKind = "telegram" | "slack" | "discord" | "teams" | "webhook" | "whatsapp";

export type ChannelInboundMessage = {
  channel: ChannelKind;
  externalThreadId: string;
  externalUserId: string;
  externalMessageId: string;
  text: string;
  displayName?: string;
  username?: string;
  replyToMessageId?: string;
  raw?: unknown;
};

export type ChannelOutboundMessage = {
  externalThreadId: string;
  text: string;
  replyToMessageId?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
};

export type ChatRunnerRequest = {
  orgId: string;
  threadKey: string;
  inbound: ChannelInboundMessage;
};

export type ChatRunnerResult = {
  replyText: string;
  /** Suppress outbound when the runner already sent via side channel */
  skipOutbound?: boolean;
};

export type ChatRunner = (req: ChatRunnerRequest) => Promise<ChatRunnerResult>;

export type TelegramChannelConfig = {
  orgId: string;
  botToken: string;
  webhookSecret: string;
  /** When true, only process private chats (DMs). */
  dmOnly?: boolean;
};

export type TelegramWebhookDeps = {
  config: TelegramChannelConfig;
  chatRunner: ChatRunner;
  /** Optional: persist thread key ↔ external chat id */
  resolveThreadKey?: (chatId: string, messageThreadId?: number) => string;
  now?: () => number;
};
