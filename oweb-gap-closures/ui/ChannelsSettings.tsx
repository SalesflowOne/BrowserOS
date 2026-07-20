/**
 * Channels settings UI — Telegram + WhatsApp connect flows.
 * Drop into OWeb Settings → Channels page.
 *
 * Framework-agnostic React; uses fetch against integration API routes.
 */
import * as React from "react";

export type ChannelsSettingsProps = {
  orgId: string;
  apiBase: string;
  /** Optional bearer for authenticated setup endpoints */
  authToken?: string;
};

type ChannelStatus = {
  telegram: boolean;
  whatsapp: boolean;
  routes: { telegram: string; whatsapp: string };
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: "#0ea5e9",
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
};

export function ChannelsSettings({ orgId, apiBase, authToken }: ChannelsSettingsProps) {
  const [status, setStatus] = React.useState<ChannelStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const [telegramToken, setTelegramToken] = React.useState("");
  const [telegramSecret, setTelegramSecret] = React.useState("");
  const [waSid, setWaSid] = React.useState("");
  const [waToken, setWaToken] = React.useState("");
  const [waFrom, setWaFrom] = React.useState("whatsapp:+14155238886");

  const headers = React.useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  const loadStatus = React.useCallback(async () => {
    const res = await fetch(`${apiBase}/api/channels/status?org=${encodeURIComponent(orgId)}`, {
      headers,
    });
    if (res.ok) setStatus((await res.json()) as ChannelStatus);
  }, [apiBase, orgId, headers]);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function setupTelegram(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/channels/telegram/setup`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          orgId,
          botToken: telegramToken,
          webhookSecret: telegramSecret,
          dmOnly: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMessage(`Telegram connected. Webhook: ${json.webhookUrl}`);
      await loadStatus();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function setupWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/channels/whatsapp/setup`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          orgId,
          accountSid: waSid,
          authToken: waToken,
          fromWhatsApp: waFrom,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMessage(`WhatsApp configured. Set Twilio webhook to: ${json.webhookUrl}`);
      await loadStatus();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Messaging Channels</h2>
      <p style={{ color: "#64748b", marginBottom: 24, fontSize: 14 }}>
        Connect Telegram and WhatsApp so your agent can receive and reply to messages.
      </p>

      {status && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <Badge active={status.telegram} label="Telegram" />
          <Badge active={status.whatsapp} label="WhatsApp" />
        </div>
      )}

      {message && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {message}
        </div>
      )}

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Telegram</h3>
        <form onSubmit={setupTelegram} style={{ display: "grid", gap: 10 }}>
          <input
            style={inputStyle}
            placeholder="Bot token from @BotFather"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            type="password"
            required
          />
          <input
            style={inputStyle}
            placeholder="Webhook secret (openssl rand -hex 32)"
            value={telegramSecret}
            onChange={(e) => setTelegramSecret(e.target.value)}
            type="password"
            required
          />
          <button type="submit" style={buttonStyle} disabled={loading}>
            Connect Telegram
          </button>
        </form>
      </section>

      <section>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>WhatsApp (Twilio)</h3>
        <form onSubmit={setupWhatsApp} style={{ display: "grid", gap: 10 }}>
          <input
            style={inputStyle}
            placeholder="Twilio Account SID"
            value={waSid}
            onChange={(e) => setWaSid(e.target.value)}
            required
          />
          <input
            style={inputStyle}
            placeholder="Twilio Auth Token"
            value={waToken}
            onChange={(e) => setWaToken(e.target.value)}
            type="password"
            required
          />
          <input
            style={inputStyle}
            placeholder="From WhatsApp number"
            value={waFrom}
            onChange={(e) => setWaFrom(e.target.value)}
            required
          />
          <button type="submit" style={buttonStyle} disabled={loading}>
            Connect WhatsApp
          </button>
        </form>
      </section>
    </div>
  );
}

function Badge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        background: active ? "#dcfce7" : "#f1f5f9",
        color: active ? "#166534" : "#64748b",
      }}
    >
      {label}: {active ? "Connected" : "Not connected"}
    </span>
  );
}

export default ChannelsSettings;
