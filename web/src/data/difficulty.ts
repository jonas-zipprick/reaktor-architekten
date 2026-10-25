import type { ScenarioMission } from './scenarios'

export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme'

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Leicht',
  normal: 'Normal',
  hard: 'Schwer',
  extreme: 'Extrem',
}

export const DIFFICULTY_BLURBS: Record<Difficulty, string> = {
  easy: 'Gebühr −1 · 14 Runden · Ausbau bis R10',
  normal: 'Szenariowerte · 12 Runden',
  hard: 'Gebühr +1 · 12 Runden',
  extreme: 'Gebühr +1 · 10 Runden',
}

/** Adjust freibeuter fee for the chosen difficulty (min 1). */
export function difficultyFee(base: number, difficulty: Difficulty): number {
  if (difficulty === 'easy') return Math.max(1, base - 1)
  if (difficulty === 'hard' || difficulty === 'extreme') return base + 1
  return base
}

/** Scale mission timers for the chosen difficulty. */
export function missionForDifficulty(
  base: ScenarioMission,
  difficulty: Difficulty,
): ScenarioMission {
  if (difficulty === 'easy') {
    return {
      ...base,
      rounds: 14,
      stableRounds: [13, 14],
      consumerDeadline: 10,
    }
  }
  if (difficulty === 'extreme') {
    return {
      ...base,
      rounds: 10,
      stableRounds: [9, 10],
      consumerDeadline: 8,
    }
  }
  // normal + hard keep 12 / 11+12 / deadline 8
  return {
    ...base,
    rounds: 12,
    stableRounds: [11, 12],
    consumerDeadline: 8,
  }
}
