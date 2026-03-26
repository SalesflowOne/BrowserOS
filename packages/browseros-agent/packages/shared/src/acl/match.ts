import type { AclRule, ElementProperties } from '../types/acl'

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

export function matchesSitePattern(url: string, pattern: string): boolean {
  if (!pattern) return false
  try {
    const { hostname, pathname } = new URL(url)
    const fullPath = hostname + pathname
    return globToRegex(pattern).test(fullPath)
  } catch {
    return false
  }
}

export function matchesElement(
  props: ElementProperties,
  rule: AclRule,
): boolean {
  if (!rule.selector && !rule.textMatch) return false

  if (rule.textMatch) {
    const text = props.textContent.toLowerCase()
    const match = rule.textMatch.toLowerCase()
    if (!text.includes(match)) return false
  }

  return true
}

export function findMatchingRules(
  url: string,
  props: ElementProperties,
  rules: AclRule[],
): AclRule[] {
  const siteRules = rules.filter(
    (r) => r.enabled && matchesSitePattern(url, r.sitePattern),
  )
  return siteRules.filter((r) => {
    if (!r.selector && !r.textMatch) return true
    return matchesElement(props, r)
  })
}
