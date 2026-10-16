import type { Axial, LandscapeTerrain, PlayerId } from '../types'
import { hexDisk } from '../hex/math'

/** Board radius — change here to grow/shrink the map. */
export const BOARD_RADIUS = 3

/** Starting money pile (gameRules.md). Players take 4 each at setup. */
export const BANK_START = 50

/** Planet meters ≥ this or ≤ −this destroy the colony at round end. */
export const CRITICAL_LIMIT = 8

/**
 * Landscape stack (gameRules.md §3): 22 empty, 4 planets, 5 sources, 4 asteroids.
 */
export const LANDSCAPE_TILES: LandscapeTerrain[] = [
  'uranium',
  'sun',
  'sun',
  'water',
  'water',
  'mountain',
  'mountain',
  'mountain',
  'mountain',
  'planet',
  'planet',
  'planet',
  'planet',
  ...Array.from({ length: 22 }, () => 'empty' as const),
]

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Face-down landscape stack for exploration. */
export function buildLandscapeDeck(
  rng: () => number = Math.random,
): LandscapeTerrain[] {
  return shuffle(LANDSCAPE_TILES, rng)
}

/**
 * Ship spawn hexes (gameRules.md §3):
 * S1 unten links, S2 oben rechts (pointy-top axial).
 */
export const SHIP_SPAWNS: Record<PlayerId, Axial> = {
  1: { q: -BOARD_RADIUS, r: BOARD_RADIUS },
  2: { q: BOARD_RADIUS, r: -BOARD_RADIUS },
}

export function allBoardHexes(): Axial[] {
  return hexDisk(BOARD_RADIUS)
}
