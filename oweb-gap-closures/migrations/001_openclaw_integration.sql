-- OWeb OpenClaw integration migrations
-- Apply via Supabase migration or enable_database + query_database

-- Channel configs (Telegram, WhatsApp)
CREATE TABLE IF NOT EXISTS ao_channel_configs (
  org_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  config jsonb NOT NULL DEFAULT '{}',
  webhook_secret text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, channel)
);

-- Per-org webhook routes
CREATE TABLE IF NOT EXISTS ao_webhook_routes (
  id text NOT NULL,
  org_id uuid NOT NULL,
  secret text NOT NULL,
  thread_key text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

-- Scheduled agent jobs (cron-lite)
CREATE TABLE IF NOT EXISTS ao_cron_jobs (
  id text NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL,
  schedule jsonb NOT NULL,
  thread_key text NOT NULL,
  message text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

-- Index for ao_skills pattern_key upserts (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS ao_skills_org_pattern_key_idx
  ON ao_skills (org_id, pattern_key)
  WHERE pattern_key IS NOT NULL;
