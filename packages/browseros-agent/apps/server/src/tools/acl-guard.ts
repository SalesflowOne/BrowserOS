import { matchesElement, matchesSitePattern } from '@browseros/shared/acl/match'
import type { AclRule } from '@browseros/shared/types/acl'
import type { Browser } from '../browser/browser'

const GUARDED_TOOLS = new Set([
  'click',
  'click_at',
  'fill',
  'type_at',
  'hover',
  'hover_at',
  'drag',
  'drag_at',
  'focus',
  'clear',
  'check',
  'uncheck',
  'select_option',
  'press_key',
  'upload_file',
  'scroll',
])

export interface AclCheckResult {
  blocked: boolean
  rule?: AclRule
}

export async function checkAcl(
  toolName: string,
  args: Record<string, unknown>,
  browser: Browser,
  rules: AclRule[],
): Promise<AclCheckResult> {
  if (!GUARDED_TOOLS.has(toolName)) return { blocked: false }
  if (!rules.length) return { blocked: false }

  const pageId = args.page as number | undefined
  if (pageId === undefined) return { blocked: false }

  const pageInfo = browser.getPageInfo(pageId)
  if (!pageInfo) return { blocked: false }

  const siteRules = rules.filter((r) =>
    matchesSitePattern(pageInfo.url, r.sitePattern),
  )
  if (!siteRules.length) return { blocked: false }

  const siteOnlyRule = siteRules.find((r) => !r.selector && !r.textMatch)
  if (siteOnlyRule) return { blocked: true, rule: siteOnlyRule }

  const elementId = args.element as number | undefined
  if (elementId === undefined) return { blocked: false }

  const props = await browser.resolveElementProperties(pageId, elementId)
  if (!props) return { blocked: false }

  for (const rule of siteRules) {
    if (matchesElement(props, rule)) {
      return { blocked: true, rule }
    }
  }

  return { blocked: false }
}
