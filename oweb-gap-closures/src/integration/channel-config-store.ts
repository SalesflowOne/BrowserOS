/**
 * Channel config persistence — in-memory for dev, Supabase adapter for prod.
 */
import type { OrgIntegrationConfig } from "./types.js";
import type { TelegramChannelConfig } from "../channels/telegram-channel.server.js";
import type { TwilioWhatsAppConfig } from "../channels/whatsapp-twilio-channel.server.js";

export type ChannelConfigStore = {
  get(orgId: string): Promise<OrgIntegrationConfig | null>;
  upsertTelegram(orgId: string, config: Omit<TelegramChannelConfig, "orgId">): Promise<void>;
  upsertWhatsApp(orgId: string, config: Omit<TwilioWhatsAppConfig, "orgId">): Promise<void>;
  deleteChannel(orgId: string, channel: "telegram" | "whatsapp"): Promise<void>;
};

export function createInMemoryChannelConfigStore(): ChannelConfigStore & {
  _data: Map<string, OrgIntegrationConfig>;
} {
  const data = new Map<string, OrgIntegrationConfig>();

  return {
    _data: data,
    async get(orgId) {
      return data.get(orgId) ?? null;
    },
    async upsertTelegram(orgId, config) {
      const existing = data.get(orgId) ?? { orgId };
      data.set(orgId, {
        ...existing,
        orgId,
        telegram: { orgId, ...config },
      });
    },
    async upsertWhatsApp(orgId, config) {
      const existing = data.get(orgId) ?? { orgId };
      data.set(orgId, {
        ...existing,
        orgId,
        whatsapp: { orgId, ...config },
      });
    },
    async deleteChannel(orgId, channel) {
      const existing = data.get(orgId);
      if (!existing) return;
      if (channel === "telegram") delete existing.telegram;
      else delete existing.whatsapp;
      data.set(orgId, existing);
    },
  };
}

/** SQL migration stub for OWeb Supabase — run via apply_migration */
export const CHANNEL_CONFIG_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS ao_channel_configs (
  org_id uuid NOT NULL REFERENCES ao_orgs(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  config jsonb NOT NULL DEFAULT '{}',
  webhook_secret text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, channel)
);

CREATE TABLE IF NOT EXISTS ao_webhook_routes (
  id text NOT NULL,
  org_id uuid NOT NULL REFERENCES ao_orgs(id) ON DELETE CASCADE,
  secret text NOT NULL,
  thread_key text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS ao_cron_jobs (
  id text NOT NULL,
  org_id uuid NOT NULL REFERENCES ao_orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  schedule jsonb NOT NULL,
  thread_key text NOT NULL,
  message text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);
`;
