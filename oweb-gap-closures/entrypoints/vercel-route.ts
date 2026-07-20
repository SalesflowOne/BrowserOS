/**
 * Vercel / Edge entrypoint — re-export for OWeb app router.
 *
 * In OWeb (Next.js App Router), create:
 *   app/api/[...oweb]/route.ts
 */
import { createOwebIntegration } from "../src/integration/api-router.js";
import { createInMemoryChannelConfigStore } from "../src/integration/channel-config-store.js";
import { createEchoChatRunner } from "../src/integration/chat-runner-http.js";
import { createInMemoryMemoryStore } from "../src/mcp/memory-tools.server.js";

const store = createInMemoryChannelConfigStore();

/** Replace with env-based config in production */
export const integration = createOwebIntegration({
  publicBaseUrl: process.env.OWEB_PUBLIC_URL ?? "https://oweb.one",
  cronSecret: process.env.CRON_SECRET,
  channelStore: store,
  getOrgConfig: (orgId) => store.get(orgId),
  getWebhookRoute: async (orgId, routeId) => {
    const org = await store.get(orgId);
    return org?.webhookRoutes?.find((r) => r.id === routeId) ?? null;
  },
  chatRunner: createEchoChatRunner(),
  memoryStore: createInMemoryMemoryStore(),
});

export async function GET(request: Request) {
  return integration.handle(request);
}

export async function POST(request: Request) {
  return integration.handle(request);
}
