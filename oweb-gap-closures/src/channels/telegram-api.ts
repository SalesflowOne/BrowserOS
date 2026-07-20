/**
 * Minimal Telegram Bot API client (no grammy dependency).
 * Uses native fetch — suitable for Vercel/serverless.
 */

const API_BASE = "https://api.telegram.org";

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function callTelegramApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json()) as TelegramApiResponse<T>;
  if (!json.ok) {
    throw new Error(json.description ?? `Telegram API ${method} failed (${res.status})`);
  }
  return json.result as T;
}

export async function sendTelegramMessage(
  token: string,
  params: {
    chat_id: string | number;
    text: string;
    reply_to_message_id?: number;
    message_thread_id?: number;
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  },
): Promise<TelegramMessage> {
  return callTelegramApi<TelegramMessage>(token, "sendMessage", params);
}

export async function setTelegramWebhook(
  token: string,
  params: {
    url: string;
    secret_token?: string;
    allowed_updates?: string[];
    drop_pending_updates?: boolean;
  },
): Promise<boolean> {
  return callTelegramApi<boolean>(token, "setWebhook", params);
}

export async function deleteTelegramWebhook(token: string): Promise<boolean> {
  return callTelegramApi<boolean>(token, "deleteWebhook");
}

export function extractTelegramMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? null;
}

export function telegramThreadKey(chatId: number | string, messageThreadId?: number): string {
  const base = String(chatId);
  return messageThreadId ? `${base}:thread:${messageThreadId}` : base;
}

export function splitTelegramText(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.5) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
