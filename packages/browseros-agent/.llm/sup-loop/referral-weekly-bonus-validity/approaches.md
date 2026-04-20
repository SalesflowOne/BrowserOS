# Referral Weekly Bonus Validity Approaches

## Recommended: Gateway bonus-grant ledger

Add a `bonus_credit_grants` table inside the gateway `CreditTracker` Durable Object. Keep the existing `credits` table as the daily base balance, and represent referral rewards as separate grants with `remaining_credits`, `granted_at`, `expires_at`, `reason`, and optional `source_id`.

Requests consume daily base credits first, then unexpired bonus grants in earliest-expiry order. Daily reset only restores base credits. Expiry pruning removes or ignores bonus grants after seven rolling days. `GET /credits/:browserOsId` returns the aggregate active balance plus bonus metadata.

Pros:
- Models the product rule directly: daily credits reset daily, referral bonuses roll over for seven days.
- Makes expiry and deduction auditable per grant.
- Allows idempotent referral grants by `source_id`, which closes a duplicate-grant race in the current referral flow.
- Can enforce the active-credit cap at the gateway instead of relying on extension UI.

Cons:
- Requires a small Durable Object SQL schema migration path and more tests.
- The aggregate `credits` field becomes derived from base plus bonus, so API consumers need optional metadata for a clearer UI.

## Alternative: Change `RESET_INTERVAL` from daily to weekly

Set the gateway reset interval to weekly and update UI copy so credits reset weekly.

Pros:
- Minimal code change.
- No new schema or deduction logic.

Cons:
- Changes the entire free-credit model, not just referral bonuses.
- Lets normal daily credits roll over for a week, which is not what the user asked for.
- Removes the daily return/replenishment behavior and makes rate-limit messaging less clear.

## Alternative: Referral service delayed re-grant

Keep the gateway daily reset unchanged. Store referral submissions in the Fly service and re-grant unused bonuses after each daily reset until seven days pass.

Pros:
- Avoids changing the gateway schema.
- Keeps the referral service as the only referral-specific system.

Cons:
- The gateway remains unaware of true credit ownership, so "unused" bonus credits cannot be calculated accurately after mixed spending.
- Requires scheduled jobs and retry semantics in the Fly service.
- Easy to double-grant or miss grants during service downtime.

## Pick

Pick the gateway bonus-grant ledger.

It is the simplest option that preserves the existing daily allowance while making referral bonuses valid for a rolling week. The extra schema and tests are worth it because expiration, spending, idempotency, and cap enforcement all belong next to the authoritative credit balance.
