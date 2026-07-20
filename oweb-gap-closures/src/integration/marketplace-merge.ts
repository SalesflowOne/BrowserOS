/**
 * Drop-in patch for src/lib/composio-marketplace.ts
 * Merge OPENCLAW_GAP_MARKETPLACE_TOOLKITS into curated marketplace array.
 */
import {
  OPENCLAW_GAP_MARKETPLACE_TOOLKITS,
  getMissingOpenClawMarketplaceSlugs,
} from "../src/marketplace/composio-additions.js";

export function mergeOpenClawMarketplaceEntries<T extends { slug: string }>(
  existing: T[],
): T[] {
  const slugs = new Set(existing.map((e) => e.slug));
  const missing = getMissingOpenClawMarketplaceSlugs(slugs);
  const additions = OPENCLAW_GAP_MARKETPLACE_TOOLKITS.filter((t) =>
    missing.includes(t.slug),
  );
  return [...existing, ...(additions as unknown as T[])];
}
