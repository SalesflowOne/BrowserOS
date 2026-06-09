/**
 * Scripted-but-real demo inputs for the LinkedIn content-marketing skills.
 * Every browser action is genuinely performed; only these INPUTS are hard-set so the
 * agent never improvises on camera. Edit before filming (set the demo account handle).
 */
export const DEMO_DEFAULTS = {
  // Target defaults to the USER's own logged-in LinkedIn (the hero shot for voice extraction).
  targetProfileUrl: 'https://www.linkedin.com/in/nithinsonti/',
  targetActivityUrl:
    'https://www.linkedin.com/in/nithinsonti/recent-activity/all/',
  market: 'AI agents / browser automation',
  audience: 'founders and early-stage builders',
  draftCount: 5,
  // ~10 pre-set LinkedIn content searches for the trends skill. Opened in parallel,
  // each sorted by most-recent. No search API — these are live-browsed.
  marketSearchUrls: [
    'https://www.linkedin.com/search/results/content/?keywords=AI%20agents&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=AI%20employees&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=browser%20automation&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=agentic%20workflows&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=automate%20marketing&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=marketing%20automation%20AI&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=AI%20SDR&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=founder%20automation&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=AI%20agent%20startup&sortBy=%22date_posted%22',
    'https://www.linkedin.com/search/results/content/?keywords=content%20automation%20LinkedIn&sortBy=%22date_posted%22',
  ],
} as const
