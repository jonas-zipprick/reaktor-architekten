/** Shared game types — adjust here when rules change. */

export type PlayerId = 1 | 2

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

export type PhaseId = 'order' | 'act' | 'simulate'

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

export interface PlacedField {
  kind: FieldKind
  owner: PlayerId
  /** Bound charges currently on this field */
  charge: ChipColor[]
  /** Flight arrow, chosen when the factory is built. */
  dir?: DirIndex
  /** Usage fee paid to the owner to trigger a non-destructive effect. 0–10. */
  fee?: number
  /** What a Speicher charge actually is. Turbine water and trafo voltage are implied. */
  chargeResource?: ChipResource
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
   * Player who paid to develop this source.
   * Unset sources stay silent: no arrow, no emission.
   */
  sourceOwner?: PlayerId
  /** Firing direction, chosen when the source is developed. */
  sourceDir?: DirIndex
  field?: PlacedField
}

export interface PlayerState {
  money: number
  /** Virtual money earned after the bank ran out (counts for winning). */
  owed: number
}

export type Winner = PlayerId | 'draw'

export type ToolMode = 'select' | 'place' | 'remove' | 'fee'
