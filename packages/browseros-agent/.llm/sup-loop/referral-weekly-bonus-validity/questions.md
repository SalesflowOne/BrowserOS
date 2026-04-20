# Referral Weekly Bonus Validity Questions

## Batch 1

1. Where does the current 24-hour bonus-credit expiration actually come from: referral service, gateway, or extension UI?

**Answer:** [grounded] The expiration comes from the gateway. `browseros-ai-gateway/src/durable-objects/CreditTracker.ts` stores a single `credits` balance and `ensureReset()` overwrites that balance with `DEFAULT_CREDITS` whenever `RESET_INTERVAL=daily` crosses a day boundary. The referral service only calls `POST /credits/:browserOsId/bonus`; the extension only displays the balance and daily reset copy.

2. Should one-week validity apply to all credits or only referral bonus credits?

**Answer:** [grounded] Only referral bonus credits should last one week. The gateway config and UI still model a daily free allowance (`DEFAULT_CREDITS`, `dailyLimit`, "Resets daily"), and the user's request is specifically about "bonus tokens" earned from the referral system.

3. What should happen to the daily free credit allowance while bonus credits roll over for a week?

**Answer:** [default] Keep the daily free allowance resetting daily, and keep bonus credits in a separate reserve. Requests should consume daily credits first, then the oldest expiring bonus credits. This preserves the daily-credit product contract while letting referral rewards roll over.

## Batch 2

1. Should the one-week validity be a fixed weekly reset or a rolling seven days from each accepted tweet?

**Answer:** [grounded] Use rolling seven-day validity per bonus grant. The user's prompt explicitly asks whether it can "rollover for a week," and the prior analysis recommends "7-day rolling expiration, not 24h, not no-expiry."

2. Should users be allowed to stockpile unlimited bonus credits across the week?

**Answer:** [grounded] No. The extension already has `REFERRAL_LIMITS.MAX_DAILY_CREDITS = 500` and blocks sharing when the displayed balance reaches that threshold. The design should preserve this as a total active-credit cap and move enforcement to the gateway so it is not only a UI rule.

3. Does the current system have server-side protection against repeat grants or only extension-side limits?

**Answer:** [grounded] It has tweet URL dedupe in the Fly referral service (`dedup-store.ts`) and the UI cap, but the gateway bonus endpoint accepts any authenticated bonus request up to amount 1000 and does not know the source tweet. A service crash after grant but before recording the submission could allow a duplicate grant on retry.

## Batch 3

1. What implementation boundary should own bonus expiry: the Fly referral service or the Cloudflare gateway credit Durable Object?

**Answer:** [grounded] The gateway Durable Object should own bonus expiry because it is the authority for credit balance, request deduction, and daily reset. The referral service should remain responsible for tweet validation and should pass a stable source id so the gateway can make grants idempotent.

2. What user-visible API/UI changes are required so users understand bonus credits now last a week?

**Answer:** [grounded] `GET /credits/:browserOsId` currently returns `credits`, `dailyLimit`, and `lastResetAt`; `useCredits()` and `UsagePage.tsx` display only daily reset semantics. The API should add optional bonus fields such as `bonusCredits`, `bonusExpiresAt`, and `maxCredits`; the extension should change "Daily cap" to "active credit cap" and show "bonus valid for 7 days" or the nearest bonus expiry.

3. What tests are needed to prove weekly bonus validity without relying on live Twitter/X or production gateway calls?

**Answer:** [grounded] Gateway unit/API tests should cover adding bonus grants, daily reset preserving unexpired bonus, expiry after seven days, oldest-expiring bonus consumption, cap enforcement, and source-id idempotency. Referral-service tests should mock `grantBonusCredits` to assert it sends `sourceId` and maps cap/idempotency errors. Extension tests are not currently obvious in this package for `ShareForCredits`, so a focused typecheck plus any existing UI test harness is the conservative verification path.
