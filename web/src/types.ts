export type Suit = 'hearts' | 'spades' | 'energy' | 'diamonds' | 'clubs'
/** Rohstoffe (gameRules §2.2). */
export type RawSuit = 'hearts' | 'spades' | 'energy'
/** Fertigprodukte (gameRules §2.2). */
export type ProductSuit = 'diamonds' | 'clubs'
export type Rank = 7 | 6 | 5 | 4 | 3 | 2 | 1 // 1 = Ass

export const SUITS: Suit[] = [
  'energy',
  'hearts',
  'spades',
  'diamonds',
  'clubs',
]
export const RAW_SUITS: RawSuit[] = ['energy', 'hearts', 'spades']
export const PRODUCT_SUITS: ProductSuit[] = ['diamonds', 'clubs']

export type PlayerId = 'white' | 'black' | 'red' | 'green'
/** Szenario legt die Spielerzahl fest (A = 1, sonst ≥ 2). */
export type ScenarioId = 'A' | 'B' | 'C' | 'D'

export type FieldKind = 'source' | 'factory' | 'storage' | 'market'
export type FieldId = string
/** Betriebe gehören dem Staat oder einem Spieler. */
export type Owner = PlayerId | 'state'

export interface Card {
  id: string
  suit: Suit
  rank: Rank
}

/** Kartenanzahl je Farbe: Produktionsrezept einer Fabrik (♥/♠). */
export type Recipe = Partial<Record<Suit, number>>

export interface ScenarioField {
  id: FieldId
  kind: FieldKind
  label: string
  /** Quelle/Markt: Farbe. Fabrik: Produktfarbe. */
  suit?: Suit
  /** Fabrik: benötigte Rohstoffe. */
  recipe?: Recipe
  /** Abweichende staatliche Startgebühr (Standard 1). */
  fee?: number
  /** Zeile: 0 Quellen, 1 Fabriken|Infrastruktur, 2 Märkte. */
  row: number
}

export interface ScenarioDef {
  id: ScenarioId
  name: string
  players: PlayerId[]
  description: string
  fields: ScenarioField[]
}

export interface FieldState {
  id: FieldId
  kind: FieldKind
  label: string
  suit?: Suit
  recipe?: Recipe
  row: number
  /** Nur Infrastruktur (Lager): Staat oder Spieler. Sonst herrenlos. */
  owner?: Owner
  /** Nur Infrastruktur (Lager): Nutzungsgebühr. Sonst 0. */
  fee: number
  /**
   * Offener Stapel (unten → oben).
   * Quelle: Vorrat.
   * Fabrik: Rohstoffe oder Fertigprodukte.
   * Lager: Umsortieren.
   * Markt: gelieferte Karten (werden am Zugende abgeräumt).
   */
  stack: Card[]
  /**
   * Markt: einzelner Bedarfsmesser (−8…0), startet bei 0.
   */
  demand?: number
}

export interface DeckState {
  draw: Card[]
  discard: Card[]
}

export interface PlayerState {
  id: PlayerId
  name: string
  money: number
  bankClaims: number
  color: string
}

export interface GameLogEntry {
  id: number
  text: string
  tone?: 'info' | 'money' | 'production' | 'market' | 'tension' | 'end'
}

export interface GameStats {
  productions: number
  /** Lieferungen auf Märkte. */
  productsDelivered: number
  /** Markt-Kollapse (Messer unter −8). */
  marketCollapses: number
  sourceCollapses: number
  /** Durch Befriedigung gespawnte Märkte. */
  marketsSpawned: number
  stacksClearedByAce: number
  /** Einkommen aus Markt-Lieferungen. */
  marketIncome: number
  feesPaidToPlayers: number
  feesPaidToBank: number
  auctionsSold: number
  auctionVolume: number
}

export interface GameState {
  scenarioId: ScenarioId
  fields: Record<FieldId, FieldState>
  decks: Record<Suit, DeckState>
  players: PlayerState[]
  currentPlayerIndex: number
  startPlayerIndex: number
  bank: number
  auctionUsed: boolean
  selection: { fieldId: FieldId; count: number } | null
  actionError: string | null
  demandRollSeq: number
  demandRollFlash: string[] | null
  demandRollIds: FieldId[]
  /** Kollaps-/Spawn-Flash. */
  planetLimitSeq: number
  planetLimitFlash: string | null
  planetLimitId: FieldId | null
  producedIds: FieldId[]
  stats: GameStats
  log: GameLogEntry[]
  logSeq: number
  turn: number
  ended: boolean
  winnerText: string | null
  rngSeed: number
  /** Laufende Nummer für gespawnte Markt-IDs. */
  marketSpawnSeq: number
  /**
   * Globaler Exp-Zähler: +1 je Zugende, bei Schwellwert Spawn,
   * Reset bei jedem Marktkollaps oder nach Spawn.
   */
  marketExp: number
}

/** Nur Lager (Infrastruktur) haben Eigentümer und Gebühren. */
export function hasOwnership(kind: FieldKind): boolean {
  return kind === 'storage'
}

/** Unterhalb davon kollabiert ein Markt. */
export const TENSION_MIN = -8
/** Messer steigt beim Liefern höchstens bis hier. */
export const TENSION_MAX = 0
/**
 * Globaler Exp-Zähler: so viele Zugenden ohne Marktkollaps,
 * dann Erweiterung (Reset bei Kollaps oder nach Spawn).
 */
export const MARKET_EXP_TO_SPAWN = 10

export function rankLabel(rank: Rank): string {
  return rank === 1 ? 'A' : String(rank)
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return '♥'
    case 'spades':
      return '♠'
    case 'energy':
      return '⚡'
    case 'diamonds':
      return '♦'
    case 'clubs':
      return '♣'
  }
}

export function suitName(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return 'Herz'
    case 'spades':
      return 'Pik'
    case 'energy':
      return 'Energie'
    case 'diamonds':
      return 'Karo'
    case 'clubs':
      return 'Kreuz'
  }
}

export function isRawSuit(suit: Suit): suit is RawSuit {
  return suit === 'hearts' || suit === 'spades' || suit === 'energy'
}

export function isProductSuit(suit: Suit): suit is ProductSuit {
  return suit === 'diamonds' || suit === 'clubs'
}

export function recipeSize(recipe: Recipe): number {
  let n = 0
  for (const suit of SUITS) n += recipe[suit] ?? 0
  return n
}

export function recipeSuits(recipe: Recipe): Suit[] {
  const out: Suit[] = []
  for (const suit of SUITS) {
    for (let i = 0; i < (recipe[suit] ?? 0); i++) out.push(suit)
  }
  return out
}

export function recipeLabel(recipe: Recipe): string {
  return recipeSuits(recipe).map(suitSymbol).join('')
}

export function suitCounts(cards: Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = {
    hearts: 0,
    spades: 0,
    energy: 0,
    diamonds: 0,
    clubs: 0,
  }
  for (const c of cards) counts[c.suit] += 1
  return counts
}

export function recipeFulfillments(cards: Card[], recipe: Recipe): number {
  const counts = suitCounts(cards)
  let n = Infinity
  let anyNeed = false
  for (const suit of SUITS) {
    const need = recipe[suit] ?? 0
    if (need <= 0) continue
    anyNeed = true
    n = Math.min(n, Math.floor(counts[suit] / need))
  }
  if (!anyNeed || !Number.isFinite(n)) return 0
  return Math.max(0, n)
}

export function matchesRecipe(cards: Card[], recipe: Recipe): boolean {
  return recipeFulfillments(cards, recipe) >= 1
}

/**
 * Lieferlohn + Messer: max(0, −Messer), dann +1 höchstens auf 0.
 */
export function meterDeliveryPayout(meterBefore: number): {
  income: number
  meterAfter: number
} {
  return {
    income: Math.max(0, -meterBefore),
    meterAfter: Math.min(TENSION_MAX, meterBefore + 1),
  }
}

/** @deprecated Alias — gleiche Semantik. */
export const planetDeliveryPayout = meterDeliveryPayout

export function canStackOn(moving: Rank, targetTop: Rank): boolean {
  return moving === targetTop - 1
}
