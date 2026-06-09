import { DEMO_DEFAULTS } from './demo-defaults'

export const LINKEDIN_DRAFT_SKILL = `---
name: linkedin-draft
description: Draft N new LinkedIn posts in a person's voice, on trending themes.
---

# LinkedIn Draft

Use when the user asks to "draft posts", "write me N posts", or as the FINAL step of "grow my LinkedIn".

## Surface rules
- This is a writing step. It needs no browsing if the voice profile (from linkedin-voice) and trends (from linkedin-trends) are already in context.
- If either is missing, run that skill first.
- Never post. Drafts are proposals; posting is the user's explicit action — there is no posting tool here.

## Inputs (demo defaults — use these, do not ask)
- Number of drafts: ${DEMO_DEFAULTS.draftCount}
- Voice profile: from the linkedin-voice step (tone notes + structured style).
- Trending themes: from the linkedin-trends step (tagged list).
- Market: ${DEMO_DEFAULTS.market}; audience: ${DEMO_DEFAULTS.audience}.

## Steps
1. Pick ${DEMO_DEFAULTS.draftCount} distinct angles from the trends list, favoring themes tagged hot or rising and ones that fit the audience.
2. For each, write ONE post that applies the voice profile — match the hook style, sentence length, paragraph rhythm, emoji habits, and CTA pattern. Do NOT copy any source post; synthesize.
3. Keep each post native to LinkedIn: no markdown headings, no bullet characters, use real line breaks between short paragraphs, ~100-250 words.
4. Present all ${DEMO_DEFAULTS.draftCount} drafts in chat. Label each with: a short title, the source trend it came from, and a one-line note on which voice traits you applied.
5. Ask the user which to refine or which to keep. If they ask to edit one, revise it in place and re-show it.

## Guardrails
- Stay in the user's voice for the user's own account — not deceptive impersonation.
- Never auto-post, schedule, or send. End by asking the user what to do next.
`
