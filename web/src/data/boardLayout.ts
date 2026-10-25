import { FIELD_DEFS } from './fields'
import type {
  Axial,
  FieldKind,
  LandscapeTerrain,
  LandscapeTile,
  PlayerId,
  ZoneId,
} from '../types'
import { hexDisk, hexDistance } from '../hex/math'

/** Board radius — change here to grow/shrink the map. */
export const BOARD_RADIUS = 4

/** Inner disk that belongs to the central zone. */
export const CENTER_RADIUS = 1

/** Total money for two players. Each takes START_MONEY; the rest is the bank. */
export const BANK_START = 120

export const START_MONEY = 12

/** Paid to the bank for every owned factory at round start. */
export const FACTORY_UPKEEP = 2

export const CONSUMER_COST = 2

/** One extractor on an owned source. Each extractor yields one chip per round. */
export const EXTRACTOR_COST = 2

export const TRAFO_RELOAD_COST = 2

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

export type LandscapeDecks = Record<ZoneId, LandscapeTile[]>

/**
 * One start-zone stack: a planet, an asteroid, one source, and two factories.
 * The four sources together are always two sun and two water.
 * Factory counts are a playtest fill; the rulebook leaves the exact mix open.
 */
function startZoneKit(
  source: LandscapeTerrain,
  factories: FieldKind[],
): LandscapeTile[] {
  return [
    { terrain: 'planet' },
    { terrain: 'mountain' },
    { terrain: source },
    ...factories.map((factory) => ({ terrain: 'factory' as const, factory })),
  ]
}

function startZoneSources(rng: () => number): LandscapeTerrain[] {
  return shuffle(['sun', 'sun', 'water', 'water'], rng)
}

/**
 * Two of each common factory, two per start zone.
 * The nuclear plant is never in the center: it is added to one random start zone.
 * The center holds the transformer.
 */
function dealFactories(rng: () => number): {
  starts: FieldKind[][]
  center: FieldKind[]
} {
  const pool = shuffle<FieldKind>(
    [
      'solar',
      'solar',
      'thermalCell',
      'thermalCell',
      'turbine',
      'turbine',
      'pumped',
      'pumped',
    ],
    rng,
  )
  const starts = [0, 1, 2, 3].map((zone) => pool.slice(zone * 2, zone * 2 + 2))
  const host = Math.floor(rng() * starts.length)
  starts[host] = [...starts[host], 'nuclearPlant']
  return {
    starts,
    center: ['transformer'],
  }
}

function centerKit(factories: FieldKind[]): LandscapeTile[] {
  return [
    { terrain: 'uranium' },
    { terrain: 'planet' },
    ...factories.map((factory) => ({ terrain: 'factory' as const, factory })),
  ]
}

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
/** Legacy disk spawns (scenarios supply their own). */
export const SHIP_SPAWNS: Partial<Record<PlayerId, Axial>> = {
  1: { q: -BOARD_RADIUS, r: BOARD_RADIUS },
  2: { q: BOARD_RADIUS, r: -BOARD_RADIUS },
}

export function allBoardHexes(): Axial[] {
  return hexDisk(BOARD_RADIUS)
}

function fillDeck(
  kit: LandscapeTile[],
  count: number,
  rng: () => number,
): LandscapeTile[] {
  const tiles = [...kit]
  while (tiles.length < count) tiles.push({ terrain: 'empty' })
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
  const sources = startZoneSources(rng)
  const factories = dealFactories(rng)
  return {
    s1: fillDeck(startZoneKit(sources[0], factories.starts[0]), counts.s1, rng),
    s2: fillDeck(startZoneKit(sources[1], factories.starts[1]), counts.s2, rng),
    s3: fillDeck(startZoneKit(sources[2], factories.starts[2]), counts.s3, rng),
    s4: fillDeck(startZoneKit(sources[3], factories.starts[3]), counts.s4, rng),
    center: fillDeck(centerKit(factories.center), counts.center, rng),
  }
}

function tileWord(tile: LandscapeTile): string {
  if (tile.terrain === 'factory') return FIELD_DEFS[tile.factory].short
  return TILE_WORD[tile.terrain]
}

/** Known composition of a stack, without revealing order. */
export function describeDeck(tiles: LandscapeTile[]): string {
  const counts = new Map<string, number>()
  const seen: string[] = []
  for (const tile of tiles) {
    const word = tileWord(tile)
    if (!counts.has(word)) seen.push(word)
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  const rank = [
    'Planet',
    'Sonne',
    'Wasser',
    'Uran',
    'Asteroid',
    ...Object.values(FIELD_DEFS).map((def) => def.short),
    'leer',
  ]
  return (
    [...seen]
      .sort((a, b) => {
        const ia = rank.indexOf(a)
        const ib = rank.indexOf(b)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      })
      .map((word) => {
        const n = counts.get(word) ?? 0
        if (word === 'leer') return `${n} leer`
        return n === 1 ? word : `${n}× ${word}`
      })
      .join(' · ') || 'leer'
  )
}
