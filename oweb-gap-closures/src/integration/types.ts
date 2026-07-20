/**
 * OWeb integration types — wire gap-closures into production.
 */
import type { ChannelHubConfig } from "../channels/channel-hub.server.js";
import type { ChatRunner } from "../channels/channel-types.js";
import type { MemoryStore } from "../mcp/memory-tools.server.js";
import type { TwilioVoiceConfig } from "../mcp/twilio-voice.server.js";
import type { WebhookRouteConfig } from "../webhooks/webhook-registry.server.js";
import type { CronJob } from "../scheduler/cron-lite.server.js";

export type OrgIntegrationConfig = ChannelHubConfig & {
  twilioVoice?: TwilioVoiceConfig;
  webhookRoutes?: WebhookRouteConfig[];
  cronJobs?: Array<Omit<CronJob, "lastRunAt" | "nextRunAt">>;
};

export type OwebIntegrationDeps = {
  getOrgConfig: (orgId: string) => Promise<OrgIntegrationConfig | null>;
  getWebhookRoute: (orgId: string, routeId: string) => Promise<WebhookRouteConfig | null>;
  chatRunner: ChatRunner;
  memoryStore?: MemoryStore;
  twilioVoice?: TwilioVoiceConfig | ((orgId: string) => Promise<TwilioVoiceConfig | null>);
  /** Public base URL, e.g. https://oweb.one */
  publicBaseUrl: string;
  /** Cron secret for Vercel cron auth */
  cronSecret?: string;
};

export type AoSkillRow = {
  org_id: string;
  name: string;
  description: string | null;
  content: string;
  status: "draft" | "active";
  enabled: boolean;
  source: string;
  pattern_key: string | null;
  metadata?: Record<string, unknown>;
};
