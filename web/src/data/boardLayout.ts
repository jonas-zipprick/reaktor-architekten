import type { Axial, LandscapeTerrain, PlayerId, ZoneId } from '../types'
import { hexDisk, hexDistance } from '../hex/math'

/** Board radius — change here to grow/shrink the map. */
export const BOARD_RADIUS = 4

/** Inner disk that belongs to the central zone. */
export const CENTER_RADIUS = 1

/** Starting money pile for two players (gameRules.md). Each player takes 6. */
export const BANK_START = 60

/** Planet meters ≥ this or ≤ −this destroy the colony at round end. */
export const CRITICAL_LIMIT = 8

export const ZONE_ORDER: ZoneId[] = ['s1', 's2', 's3', 's4', 'center']

export const ZONE_LABELS: Record<ZoneId, string> = {
  s1: 'Startzone 1',
  s2: 'Startzone 2',
  s3: 'Startzone 3',
  s4: 'Startzone 4',
  center: 'Zentrum',
}

/** Short mark drawn on undiscovered hexes. */
export const ZONE_SHORT: Record<ZoneId, string> = {
  s1: '1',
  s2: '2',
  s3: '3',
  s4: '4',
  center: 'Z',
}

export type LandscapeDecks = Record<ZoneId, LandscapeTerrain[]>

/**
 * One start-zone stack (gameRules.md): a planet, an asteroid, and exactly
 * one of sun or water.
 */
function startZoneKit(rng: () => number): LandscapeTerrain[] {
  return ['planet', 'mountain', rng() < 0.5 ? 'sun' : 'water']
}

/** Central stack: uranium source, fifth planet, rest empty to fill the zone. */
const CENTER_KIT: LandscapeTerrain[] = ['uranium', 'planet']

const TILE_WORD: Record<LandscapeTerrain, string> = {
  planet: 'Planet',
  sun: 'Sonne',
  water: 'Wasser',
  uranium: 'Uran',
  mountain: 'Asteroid',
  empty: 'leer',
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Five zones on a pointy-top hex.
 *
 * The center is the disk of radius 1. The outer ring is split into four
 * start zones by screen quadrant (bottom-left, top-right, top-left,
 * bottom-right). Seams on the axes are paired under a half-turn so opposite
 * zones stay the same size: zones 1 and 2 are one hex larger, which is exactly
 * the pre-revealed ship hex, so every stack starts with the same number of tiles
 * in a two-player game.
 *
 * Ships sit in the corner of their zone; their three on-board neighbors stay
 * inside that zone.
 */
export function zoneOf(hex: Axial): ZoneId {
  if (hexDistance(hex, { q: 0, r: 0 }) <= CENTER_RADIUS) return 'center'
  const x2 = 2 * hex.q + hex.r
  if (hex.r > 0 && x2 < 0) return 's1'
  if (hex.r < 0 && x2 > 0) return 's2'
  if (hex.r < 0 && x2 < 0) return 's3'
  if (hex.r > 0 && x2 > 0) return 's4'
  if (hex.r === 0) return hex.q < 0 ? 's1' : 's2'
  return hex.r < 0 ? 's3' : 's4'
}

/**
 * Ship spawn hexes (gameRules.md §4):
 * S1 unten links, S2 oben rechts (pointy-top axial).
 */
export const SHIP_SPAWNS: Record<PlayerId, Axial> = {
  1: { q: -BOARD_RADIUS, r: BOARD_RADIUS },
  2: { q: BOARD_RADIUS, r: -BOARD_RADIUS },
}

export function allBoardHexes(): Axial[] {
  return hexDisk(BOARD_RADIUS)
}

function fillDeck(
  kit: LandscapeTerrain[],
  count: number,
  rng: () => number,
): LandscapeTerrain[] {
  const tiles = [...kit]
  while (tiles.length < count) tiles.push('empty')
  return shuffle(tiles.slice(0, Math.max(0, count)), rng)
}

/**
 * Five face-down stacks. Size matches the hexes still to explore:
 * ship start hexes are already discovered and do not take a tile.
 */
export function buildLandscapeDecks(
  rng: () => number = Math.random,
): LandscapeDecks {
  const counts: Record<ZoneId, number> = {
    s1: 0,
    s2: 0,
    s3: 0,
    s4: 0,
    center: 0,
  }
  for (const hex of allBoardHexes()) counts[zoneOf(hex)] += 1
  for (const spawn of Object.values(SHIP_SPAWNS)) {
    counts[zoneOf(spawn)] -= 1
  }
  return {
    s1: fillDeck(startZoneKit(rng), counts.s1, rng),
    s2: fillDeck(startZoneKit(rng), counts.s2, rng),
    s3: fillDeck(startZoneKit(rng), counts.s3, rng),
    s4: fillDeck(startZoneKit(rng), counts.s4, rng),
    center: fillDeck(CENTER_KIT, counts.center, rng),
  }
}

/** Known composition of a stack, without revealing order. */
export function describeDeck(tiles: LandscapeTerrain[]): string {
  const order: LandscapeTerrain[] = [
    'planet',
    'sun',
    'water',
    'uranium',
    'mountain',
    'empty',
  ]
  const counts = new Map<LandscapeTerrain, number>()
  for (const tile of tiles) counts.set(tile, (counts.get(tile) ?? 0) + 1)
  const parts = order
    .filter((tile) => (counts.get(tile) ?? 0) > 0)
    .map((tile) => {
      const n = counts.get(tile) ?? 0
      if (tile === 'empty') return `${n} leer`
      return n === 1 ? TILE_WORD[tile] : `${n}× ${TILE_WORD[tile]}`
    })
  return parts.join(' · ') || 'leer'
}
