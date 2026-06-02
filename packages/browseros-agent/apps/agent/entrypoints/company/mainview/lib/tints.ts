export type Tint = 'orange' | 'blue' | 'green' | 'purple' | 'pink' | 'teal'

interface TintTokens {
  bg: string
  fg: string
  ring: string
  soft: string
}

const TINTS: Record<Tint, TintTokens> = {
  orange: {
    bg: 'oklch(0.88 0.07 50)',
    fg: 'oklch(0.42 0.16 50)',
    ring: 'oklch(0.78 0.12 50)',
    soft: 'oklch(0.96 0.025 50)',
  },
  blue: {
    bg: 'oklch(0.88 0.06 240)',
    fg: 'oklch(0.42 0.13 240)',
    ring: 'oklch(0.78 0.10 240)',
    soft: 'oklch(0.96 0.022 240)',
  },
  green: {
    bg: 'oklch(0.88 0.07 155)',
    fg: 'oklch(0.42 0.13 155)',
    ring: 'oklch(0.78 0.10 155)',
    soft: 'oklch(0.96 0.025 155)',
  },
  purple: {
    bg: 'oklch(0.88 0.07 290)',
    fg: 'oklch(0.42 0.14 290)',
    ring: 'oklch(0.78 0.10 290)',
    soft: 'oklch(0.96 0.025 290)',
  },
  pink: {
    bg: 'oklch(0.88 0.07 0)',
    fg: 'oklch(0.45 0.15 0)',
    ring: 'oklch(0.78 0.10 0)',
    soft: 'oklch(0.96 0.025 0)',
  },
  teal: {
    bg: 'oklch(0.88 0.06 195)',
    fg: 'oklch(0.42 0.12 195)',
    ring: 'oklch(0.78 0.10 195)',
    soft: 'oklch(0.96 0.022 195)',
  },
}

export function tintTokens(t: Tint): TintTokens {
  return TINTS[t]
}
