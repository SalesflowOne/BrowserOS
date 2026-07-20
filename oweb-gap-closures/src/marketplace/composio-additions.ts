/**
 * Composio marketplace additions for OpenClaw gap closures.
 * Merge into src/lib/composio-marketplace.ts in OWeb.
 */

export const OPENCLAW_GAP_MARKETPLACE_TOOLKITS = [
  {
    slug: "telegram",
    name: "Telegram",
    description: "Send messages via Telegram Bot API (pairs with native Telegram channel).",
    category: "channels",
    openclawExtension: "telegram",
  },
  {
    slug: "spotify",
    name: "Spotify",
    description: "Control playback, search tracks, and manage playlists.",
    category: "media",
    openclawExtension: "spotify",
  },
] as const;

export type MarketplaceToolkitSlug =
  | (typeof OPENCLAW_GAP_MARKETPLACE_TOOLKITS)[number]["slug"]
  | string;

/** Returns slugs to add to curated marketplace if not already present. */
export function getMissingOpenClawMarketplaceSlugs(existing: Set<string>): string[] {
  return OPENCLAW_GAP_MARKETPLACE_TOOLKITS.map((t) => t.slug).filter((s) => !existing.has(s));
}
