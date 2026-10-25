/** Shared game types — adjust here when rules change. */

export type PlayerId = 1 | 2 | 3 | 4

export const ALL_PLAYER_IDS: PlayerId[] = [1, 2, 3, 4]

/** Active seats for a scenario size (solo uses 1). */
export function playerIdsForCount(n: 1 | 2 | 3 | 4): PlayerId[] {
  return ALL_PLAYER_IDS.slice(0, n)
}

/** Versus is competitive; solo/coop share a mission win/lose. */
export type GameMode = 'solo' | 'coop' | 'versus'

/** Chip energy tier: blue=low(1W), purple=mid(2W), red=high(3W) */
export type ChipColor = 'blue' | 'purple' | 'red'

/**
 * What a flying/free chip currently “is” (State by Location / conversion).
 * Planets accept voltage, water, heat.
 */
export type ChipResource = 'voltage' | 'water' | 'heat' | 'uranium' | 'light'

/** Planet meter / consumer type (±8 at round end is critical). */
export type MeterKind = 'voltage' | 'water' | 'heat'

/**
 * Hex edge directions for pointy-top hexes.
 * Index matches die faces: 1 = NW … clockwise.
 */
export const DIRECTIONS = [
  { id: 1, key: 'NW', label: 'NW', dq: 0, dr: -1 },
  { id: 2, key: 'NE', label: 'NE', dq: 1, dr: -1 },
  { id: 3, key: 'E', label: 'O', dq: 1, dr: 0 },
  { id: 4, key: 'SE', label: 'SO', dq: 0, dr: 1 },
  { id: 5, key: 'SW', label: 'SW', dq: -1, dr: 1 },
  { id: 6, key: 'W', label: 'W', dq: -1, dr: 0 },
] as const

export type DirIndex = 1 | 2 | 3 | 4 | 5 | 6

export type TerrainKind =
  | 'empty'
  | 'mountain'
  | 'uranium'
  | 'sun'
  | 'water'
  | 'planet'

/** Landscape tiles that come from a face-down zone stack. */
export type LandscapeTerrain =
  | 'empty'
  | 'uranium'
  | 'sun'
  | 'water'
  | 'mountain'
  | 'planet'

/**
 * Board zones (gameRules.md §1).
 * Four start zones plus the contested center. Each has its own landscape stack.
 */
export type ZoneId = 's1' | 's2' | 's3' | 's4' | 'center'

/** One settled consumer on a planet (1 die each; no personal meter). */
export interface ConsumerUnit {
  id: string
  type: MeterKind
  /** Player who paid to approve this consumer */
  approver: PlayerId
}

export type FieldKind =
  | 'divert'
  | 'solar'
  | 'thermalCell'
  | 'nuclearPlant'
  | 'turbine'
  | 'pumped'
  | 'transformer'

/** One face-down landscape tile. Factory counts are a playtest fill; the rulebook leaves the exact mix open. */
export type LandscapeTile =
  | { terrain: LandscapeTerrain }
  | { terrain: 'factory'; factory: FieldKind }

/** Offered to the player who just discovered a source, factory or planet. */
export interface DiscoveryOffer {
  id: string
  player: PlayerId
  hex: Axial
  label: string
}

export type PhaseId = 'setup' | 'order' | 'act' | 'simulate'

export interface Axial {
  q: number
  r: number
}

export interface Chip {
  id: string
  color: ChipColor
  /** bound = charge on a tile; free = unbound on tile; flying = in flight */
  state: 'bound' | 'free' | 'flying'
  hex: Axial
  dir?: DirIndex
  /** Resource identity while free/flying (soft playtest) */
  resource?: ChipResource
  /** Remaining steps this player's move (soft guide, max 5) */
  stepsLeft?: number
  /** Next step uses dir from a W6 roll instead of a factory arrow. */
  dieStep?: boolean
  /** Player who is simulating this chip. Fees and planet income use this. */
  pilot?: PlayerId
  /** How often this flight has already landed on each hex. The third landing ends the chip. */
  seen?: Record<string, number>
}

/** A flying chip is waiting on a factory or planet. */
export interface PendingHit {
  chipId: string
  hex: Axial
  /** ship: trigger or redirect. fee: pay or fly straight. color: nuclear swap. */
  mode: 'ship' | 'fee' | 'color'
}

/** Transport link on the shared edge of two hexes. Blue < purple < red. */
export type RouteTier = 'blue' | 'purple' | 'red'

export interface Route {
  owner: PlayerId
  tier: RouteTier
  /** Fee per crossing. Own links are free. No upper bound. */
  fee: number
}

export interface PlacedField {
  kind: FieldKind
  /** Null while the factory is neutral and inactive. */
  owner: PlayerId | null
  /** Bound charges currently on this field */
  charge: ChipColor[]
  /** Legacy build arrow. The current rules do not steer chips with it. */
  dir?: DirIndex
  /** Processing fee per triggered effect. Own factories are free. */
  fee?: number
  /** What a Speicher charge actually is. Turbine water and trafo voltage are implied. */
  chargeResource?: ChipResource
  /** Player who stored the Speicher chip and may release it later. */
  storedBy?: PlayerId
}

export interface CellState {
  hex: Axial
  /** Fog of war — false until explored from a ship */
  revealed: boolean
  terrain: TerrainKind
  /** Unique name when terrain is planet */
  planetName?: string
  /** Planet meters (voltage / water / heat); unused on non-planets */
  voltage: number
  water: number
  heat: number
  /** Settled consumers (only on planets) */
  consumers: ConsumerUnit[]
  /**
   * Planet owner while consumers present (first approver).
   * Cleared when colony is destroyed.
   */
  planetOwner?: PlayerId
  /** Source stock chips (bound) on a resource source */
  sourceStock: ChipColor[]
  /**
   * Player who claimed this source.
   * Neutral sources produce nothing and keep neither stock nor extractors.
   */
  sourceOwner?: PlayerId
  /**
   * Extractors on an owned source. Each one yields one chip at production.
   * Removed, together with the stock, when the source becomes neutral.
   */
  extractors?: number
  /** Mining fee per chip taken by someone else. Own takes are free. */
  sourceFee?: number
  /** Firing direction, chosen when the source is developed. */
  sourceDir?: DirIndex
  /** Import tariff per paid delivery. Skipping it still moves the meter. */
  importFee?: number
  field?: PlacedField
}

export interface PlayerState {
  money: number
  /** Virtual money earned after the bank ran out (counts for winning). */
  owed: number
}

export type Winner = PlayerId | 'draw' | 'mission'

export type ToolMode = 'select' | 'place' | 'remove' | 'fee'
