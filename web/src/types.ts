export type Suit = 'hearts' | 'clubs' | 'spades' | 'diamonds'
export type Rank = 6 | 5 | 4 | 3 | 2 | 1 // 1 = Ass

export type PlayerId = 'white' | 'black' | 'red' | 'green'
export type GameMode = 'solo' | 'coop' | 'versus'
export type ScenarioId = 'A' | 'B' | 'C' | 'D'

export type CellKind =
  | 'empty'
  | 'sun'
  | 'planet'
  | 'storage'
  | 'base'
  | 'asteroid'

export interface Coord {
  x: number
  y: number
}

export interface Card {
  id: string
  suit: Suit
  rank: Rank
  faceUp: boolean
}

export interface NeutralDefenseSpec {
  x: number
  y: number
  rank: Rank
  toll: number
}

export interface ScenarioField {
  x: number
  y: number
  kind: CellKind
  label?: string
  owner?: PlayerId
}

export interface ScenarioDef {
  id: ScenarioId
  name: string
  modes: GameMode[]
  description: string
  /** Inclusive bounds for rectangular maps; Channel World uses explicit cells. */
  bounds?: { minX: number; maxX: number; minY: number; maxY: number }
  cells: ScenarioField[]
  defenses: {
    solo: NeutralDefenseSpec[]
    coop: NeutralDefenseSpec[]
    versus: NeutralDefenseSpec[]
  }
  missions: {
    solo: { planets: string[]; defenses: number }
    coop: { planets: string[]; defenses: number }
  }
}

export interface CellState {
  x: number
  y: number
  kind: CellKind
  label?: string
  /** Base owner, or defense owner */
  owner?: PlayerId | 'neutral'
  /** Open stacks on this cell (bottom → top). */
  stack: Card[]
  /** Covered draw pile under the top face-up card (suns / bases). */
  drawPile: Card[]
  /** Toll for defensive units on this cell. */
  toll: number
  /** Neutral VP markers waiting on planets. */
  vpMarkers: number
}

export interface PlayerState {
  id: PlayerId
  name: string
  money: number
  bankClaims: number
  securedVp: number
  color: string
}

export interface MissionProgress {
  suppliedPlanets: string[]
  defensesDefeated: number
  requiredPlanets: string[]
  requiredDefenses: number
}

export interface GameLogEntry {
  id: number
  text: string
  tone?: 'info' | 'money' | 'combat' | 'vp' | 'end'
}

export type Selection =
  | { type: 'stack'; x: number; y: number; count: number }
  | { type: 'vp'; x: number; y: number }
  | null

export interface GameState {
  scenarioId: ScenarioId
  mode: GameMode
  cells: Record<string, CellState>
  players: PlayerState[]
  currentPlayerIndex: number
  bank: number
  demandDeck: Card[]
  energyReserve: Card[]
  energyDiscard: Card[]
  demandDiscard: Card[]
  missions: MissionProgress | null
  selection: Selection
  pathPreview: Coord[] | null
  pathCost: number | null
  log: GameLogEntry[]
  logSeq: number
  turn: number
  ended: boolean
  winnerText: string | null
  rngSeed: number
}

export function keyOf(x: number, y: number): string {
  return `${x},${y}`
}

export function rankLabel(rank: Rank): string {
  return rank === 1 ? 'A' : String(rank)
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return '♥'
    case 'clubs':
      return '♣'
    case 'spades':
      return '♠'
    case 'diamonds':
      return '♦'
  }
}

export function energyPayout(rank: Rank): number {
  return rank
}

export function canStackOn(movingBottom: Rank, targetTop: Rank): boolean {
  return movingBottom === targetTop - 1
}

export function isDescendingRun(cards: Card[]): boolean {
  if (cards.length === 0) return false
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].rank !== cards[i - 1].rank - 1) return false
  }
  return true
}
