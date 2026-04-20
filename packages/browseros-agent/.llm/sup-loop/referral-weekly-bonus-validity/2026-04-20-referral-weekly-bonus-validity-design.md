# Referral Weekly Bonus Validity Design

## Summary

Referral bonus credits should be valid for a rolling seven days from the accepted tweet instead of expiring at the next daily reset. Daily free credits should still reset daily. To make that true, the gateway needs to stop mixing referral bonuses into the same mutable balance as daily credits.

The design adds a gateway-owned bonus-credit grant ledger. The extension and referral service stay thin: they submit verified tweets, display bonus metadata, and surface cap/expiry states. The gateway remains the authority for balance, expiry, spending order, and idempotency.

## Decisions

- Bonus validity is rolling seven days per accepted tweet, measured as `granted_at + 7 * 24h`.
- Daily base credits continue to reset daily from `DEFAULT_CREDITS`.
- Requests spend daily base credits first, then unexpired bonus grants in earliest-expiry order.
- The gateway enforces the active-credit cap using the existing 500-credit cap value. The extension can still preemptively hide or disable sharing, but it is not trusted as the cap authority.
- The referral service passes a stable `sourceId` derived from the tweet status id so gateway bonus grants are idempotent.

## Current State

The original referral design explicitly said bonus credits expire at daily reset. The gateway implements that behavior by storing one `credits` value in `CreditTracker` and overwriting it with `DEFAULT_CREDITS` when the daily reset boundary passes.

Relevant current code:

- `browseros-ai-gateway/src/durable-objects/CreditTracker.ts`: one `credits` row, `ensureReset()`, `addCredits(amount)`.
- `browseros-ai-gateway/src/handlers/credits/bonus.ts`: authenticated `POST /credits/:browserOsId/bonus`.
- `browseros-workers/apps/referral-service/src/routes/referral.ts`: verifies tweet and calls `grantBonusCredits(browserosId, 200)`.
- `browseros-agent/apps/agent/components/referral/ShareForCredits.tsx`: shows daily-cap and midnight reset copy.
- `browseros-agent/apps/agent/lib/credits/useCredits.ts`: consumes `credits`, `dailyLimit`, `lastResetAt`, and `browserosId`.

## Architecture

```
Extension UI
  |
  | POST /referral/submit { tweetUrl, browserosId }
  v
Fly referral service
  - parses tweet URL
  - dedupes tweet URL
  - verifies tweet exists, is recent, and mentions @browseros_ai
  - calls gateway with amount + sourceId
  |
  | POST /credits/:browserOsId/bonus
  | { amount: 200, reason: "twitter_share", sourceId: "twitter:<statusId>" }
  v
Gateway CreditTracker Durable Object
  - resets daily base credits daily
  - stores bonus grants with seven-day expiry
  - enforces active-credit cap
  - deducts base first, then earliest-expiring bonus grants
```

## Gateway Design

### Data Model

Keep the existing `credits` table and reinterpret its `credits` column as daily base credits after a one-time per-Durable-Object migration.

Add:

```sql
CREATE TABLE IF NOT EXISTS bonus_credit_grants (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  remaining_credits INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Each `CreditTracker` Durable Object represents one BrowserOS user, so this table does not need a user id column.

### Legacy Migration

Run a per-object migration the first time a user is touched after deploy:

1. Create the new tables.
2. Check `credit_meta` for `bonus_ledger_migrated_at`.
3. If missing, read the current aggregate balance from `credits.credits`.
4. Set daily base credits to `min(currentBalance, defaultCredits)`.
5. If `currentBalance > defaultCredits`, create one legacy bonus grant for `currentBalance - defaultCredits` with `expires_at = now + 7 days` and `source_id = "legacy:<migration-date>"`.
6. Store `bonus_ledger_migrated_at`.

This preserves existing visible balances without accidentally turning pre-deploy referral bonuses into permanent daily base credits.

### Balance Calculation

Add helper methods inside `CreditTracker`:

- `ensureBonusSchema()`
- `migrateLegacyAggregateOnce(now)`
- `pruneExpiredBonusCredits(now)`
- `getActiveBonusCredits(now)`
- `deductFromBonusCredits(amount, now)`
- `getTotalCredits(now)`

`getCredits()` should return the existing fields plus optional metadata:

```ts
interface GetCreditsResult {
  credits: number
  dailyLimit: number
  lastResetAt: string
  bonusCredits: number
  bonusExpiresAt: string | null
  maxCredits: number
}
```

`credits` remains the aggregate active balance so existing clients stay compatible. `bonusExpiresAt` is the nearest expiry among active grants.

### Spending Order

`deductCredit()` should:

1. Ensure user/schema/migration.
2. Reset daily base credits if needed.
3. Prune expired bonus grants.
4. Deduct from daily base credits first.
5. If the request cost exceeds remaining base credits, deduct the rest from active bonus grants ordered by `expires_at ASC, granted_at ASC`.
6. Reject only if aggregate active credits are below `CREDIT_COST_PER_REQUEST`.

This keeps referral bonuses as a reserve and avoids wasting weekly bonus credits before today's free credits.

### Adding Bonus Credits

Replace `addCredits(amount)` with a bonus-aware method. The public Durable Object method can remain named `addCredits` for route compatibility, but internally it should add a bonus grant rather than mutate daily base credits.

Input:

```ts
interface AddCreditsInput {
  amount: number
  reason: string
  sourceId?: string
}
```

Output:

```ts
interface AddCreditsResult {
  credits: number
  added: number
  bonusCredits: number
  bonusExpiresAt: string | null
  duplicate?: boolean
  capped?: boolean
  maxCredits: number
}
```

Behavior:

- Reject invalid amounts as today.
- If `sourceId` already exists, return the current balance with `added: 0` and `duplicate: true`.
- If the active aggregate balance plus `amount` would exceed `MAX_ACTIVE_CREDITS`, reject the grant with a typed cap result instead of partially granting. This avoids a user sharing for "200 credits" and receiving a surprise smaller reward.
- Insert one bonus grant with `remaining_credits = amount`, `granted_at = now`, and `expires_at = now + 7 days`.

Add a gateway constant for the cap. In the agent repo, rename the shared UI constant from `MAX_DAILY_CREDITS` to `MAX_ACTIVE_CREDITS`, keeping a deprecated alias for compatibility during the rollout if needed.

### Bonus Endpoint

Update `POST /credits/:browserOsId/bonus` request body:

```json
{
  "amount": 200,
  "reason": "twitter_share",
  "sourceId": "twitter:1234567890"
}
```

Responses:

```json
{
  "credits": 250,
  "added": 200,
  "bonusCredits": 200,
  "bonusExpiresAt": "2026-04-27T18:30:00.000Z",
  "maxCredits": 500
}
```

```json
{
  "error": "credit_cap_reached",
  "credits": 450,
  "maxCredits": 500
}
```

```json
{
  "credits": 250,
  "added": 0,
  "bonusCredits": 200,
  "bonusExpiresAt": "2026-04-27T18:30:00.000Z",
  "duplicate": true,
  "maxCredits": 500
}
```

Keep bearer-token authentication unchanged. Do not commit or expose secret values while touching gateway config.

## Referral Service Design

The referral service remains responsible for tweet validation and dedupe. It should pass a stable source id to the gateway:

```ts
sourceId = `twitter:${parsed.statusId}`
```

Update `grantBonusCredits(browserosId, amount, sourceId)` to include `sourceId` in the gateway request body.

Map gateway errors to referral responses:

- `credit_cap_reached` -> `{ success: false, reason: "credit_cap_reached", credits, maxCredits }` with HTTP 409.
- `duplicate: true` -> record the submission locally if missing, then return `{ success: false, reason: "tweet_already_rewarded" }` with HTTP 409.
- Other gateway failures remain `credit_grant_failed`.

Keep existing tweet URL dedupe. Gateway idempotency is a second line of defense for retries or service crashes between grant and local `recordSubmission()`.

## Extension UI Design

Update credit types in `apps/agent/lib/credits/useCredits.ts`:

```ts
export interface CreditsInfo {
  credits: number
  dailyLimit: number
  lastResetAt?: string
  bonusCredits?: number
  bonusExpiresAt?: string | null
  maxCredits?: number
  browserosId?: string
}
```

Update `ShareForCredits`:

- Replace "Daily cap" copy with "Active credit cap".
- Disable sharing when `credits > maxCredits - CREDITS_PER_REFERRAL`, not only when `credits >= maxCredits`, so a submitted tweet can receive the full reward.
- Show "Bonus credits are valid for 7 days" in the rules.
- Surface `credit_cap_reached` as "Use some credits before earning another bonus."
- Keep submit success based on `creditsAdded` returned by the referral service.

Update `UsagePage`:

- Keep the daily reset card for the base allowance.
- When `bonusCredits > 0`, show bonus amount and nearest expiry, for example "120 bonus credits expire Apr 27".
- Keep `credits / dailyLimit` display compatible, but avoid implying the aggregate balance resets at midnight when bonus credits are present.

## Error Handling

- Expired bonus grants are ignored before balance calculation and deduction. They can be deleted or marked exhausted; deletion is simpler inside a per-user Durable Object.
- If a grant expires between UI display and request deduction, the gateway returns the fresh lower aggregate balance. Existing exhausted-credit behavior still applies.
- If the referral service cannot reach the gateway, it should not record the submission, preserving retryability.
- If the gateway reports a duplicate source id, the referral service should record the tweet locally so future duplicate checks stop before gateway calls.
- If the gateway cap rejects a grant, the referral service should not record the submission as rewarded.

## Testing

Gateway tests:

- New user still receives `DEFAULT_CREDITS` with `bonusCredits: 0`.
- `addCredits({ amount: 200, sourceId })` creates a seven-day bonus grant without changing daily base credits.
- `getCredits()` returns aggregate `credits = base + active bonus`.
- Daily reset restores base credits but preserves unexpired bonus credits.
- Bonus grants expire after seven days and stop contributing to aggregate balance.
- Deduction consumes base first, then earliest-expiring bonus grants.
- Duplicate `sourceId` does not double-grant.
- Cap rejection prevents active balance from exceeding `MAX_ACTIVE_CREDITS`.
- `POST /credits/:browserOsId/bonus` validates auth, amount, cap, and `sourceId`.

Referral-service tests:

- `grantBonusCredits()` sends `sourceId` to the gateway.
- `/referral/submit` maps `credit_cap_reached`.
- `/referral/submit` maps duplicate gateway responses to `tweet_already_rewarded` and records the submission.
- Existing tweet verification tests remain unchanged because expiry is gateway-owned.

Agent package verification:

- Typecheck the extension package.
- Add or update component tests if the package already has a local React test harness for sidepanel components.
- Manual QA in the extension: exhausted state, successful share, cap-blocked state, and usage page with bonus expiry metadata.

## Rollout

1. Deploy gateway changes first. The new `GET /credits` response is backward-compatible.
2. Deploy referral service changes to send `sourceId` and handle cap/duplicate responses.
3. Deploy extension changes to update copy and cap prechecks.
4. Monitor referral submissions for same-session bursts and multi-day repeat behavior after the seven-day expiry change.

## Out Of Scope

- No-expiry bonus credits.
- Twitter account linking.
- Per-user tweet cooldowns. A one-tweet-per-hour cooldown is still a strong follow-up if same-session bursts remain high after weekly expiry.
- Changing daily base credit limits.
- Replacing the referral service dedupe store.
