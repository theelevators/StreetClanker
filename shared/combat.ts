import type { PhraseMove } from './types.ts'

/** Absolute HP pool — bars normalize against this. Long agent fights need room. */
export const MAX_HEALTH = 1000
/**
 * Gas tank for phrases. High enough that agents can string Street Fighter-style
 * specials without constantly gassing — hits and recipes refund stamina.
 */
export const MAX_STAMINA = 220

/** Soft refund on a clean attack hit (SF meter drip). */
export const STAMINA_ON_HIT = 6
/** Extra refund per live chain hit beyond the first. */
export const STAMINA_ON_CHAIN = 4
/** Fat refund when a named recipe completes — fuels the next special. */
export const STAMINA_ON_RECIPE = 28
/** Between-round corner breathe. */
export const STAMINA_BETWEEN_ROUNDS = 55

/** Drop the trail if the fighter goes idle this long between useful beats. */
export const COMBO_WINDOW_MS = 2_400

export type ComboRecipe = {
  /** Match against the trailing moves of the live combo trail. */
  pattern: readonly PhraseMove[]
  name: string
  /** Damage multiplier applied on the beat that completes the recipe. */
  mult: number
}

/**
 * Street-fighter style strings. Longer patterns first so we prefer the
 * flashier finish when several suffixes match.
 */
export const COMBO_RECIPES: readonly ComboRecipe[] = [
  {
    pattern: ['jab', 'jab', 'punch_right'],
    name: 'Double Jab Cross',
    mult: 1.42,
  },
  {
    pattern: ['jab', 'punch_left', 'punch_right'],
    name: 'Trinity Rush',
    mult: 1.5,
  },
  {
    pattern: ['taunt', 'jab', 'punch_right'],
    name: 'Flash Cross',
    mult: 1.48,
  },
  {
    pattern: ['dodge', 'punch_right'],
    name: 'Slip Counter',
    mult: 1.45,
  },
  {
    pattern: ['dodge', 'punch_left'],
    name: 'Slip Hook',
    mult: 1.35,
  },
  {
    pattern: ['block', 'punch_right'],
    name: 'Parry Cross',
    mult: 1.35,
  },
  {
    pattern: ['block', 'punch_left'],
    name: 'Parry Hook',
    mult: 1.3,
  },
  {
    pattern: ['taunt', 'punch_right'],
    name: 'Showboat Bomb',
    mult: 1.55,
  },
  {
    pattern: ['punch_left', 'punch_right'],
    name: 'Hook Cross',
    mult: 1.28,
  },
  {
    pattern: ['jab', 'punch_right'],
    name: 'Jab Cross',
    mult: 1.22,
  },
  {
    pattern: ['jab', 'punch_left'],
    name: 'Jab Hook',
    mult: 1.18,
  },
  {
    pattern: ['jab', 'jab'],
    name: 'Double Jab',
    mult: 1.12,
  },
] as const

export type ComboEval = {
  /** Clean attack hits currently stacked in the trail. */
  count: number
  /** Best matching recipe name, if any. */
  label: string | null
  /** Final damage multiplier for this beat. */
  mult: number
  /** True when this beat newly completed a named recipe. */
  recipeJustHit: boolean
}

function trailsMatch(trail: readonly PhraseMove[], pattern: readonly PhraseMove[]) {
  if (trail.length < pattern.length) return false
  const start = trail.length - pattern.length
  for (let i = 0; i < pattern.length; i++) {
    if (trail[start + i] !== pattern[i]) return false
  }
  return true
}

/** Longest matching recipe suffix, or null. */
export function matchComboRecipe(trail: readonly PhraseMove[]): ComboRecipe | null {
  for (const recipe of COMBO_RECIPES) {
    if (trailsMatch(trail, recipe.pattern)) return recipe
  }
  return null
}

/**
 * Stack bonus from raw hit count (Street Fighter "keep the chain alive").
 * Caps so recipes stay the star of the show.
 */
export function chainLengthMult(hitCount: number) {
  if (hitCount <= 1) return 1
  return 1 + Math.min(0.06 * (hitCount - 1), 0.36)
}

/** Later beats in the same phrase hit harder when earlier punches connected. */
export function intraPhraseMult(priorHitsInPhrase: number) {
  if (priorHitsInPhrase <= 0) return 1
  return 1 + Math.min(0.14 * priorHitsInPhrase, 0.28)
}

export function evaluateCombo(opts: {
  trail: readonly PhraseMove[]
  hitCount: number
  priorHitsInPhrase: number
  prevLabel: string | null
}): ComboEval {
  const recipe = matchComboRecipe(opts.trail)
  const recipeMult = recipe?.mult ?? 1
  const mult =
    recipeMult * chainLengthMult(opts.hitCount) * intraPhraseMult(opts.priorHitsInPhrase)
  return {
    count: opts.hitCount,
    label: recipe?.name ?? (opts.hitCount >= 3 ? `${opts.hitCount} HIT` : null),
    mult,
    recipeJustHit: Boolean(recipe && recipe.name !== opts.prevLabel),
  }
}
