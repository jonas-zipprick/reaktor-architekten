export type Suit =
  | 'hearts'
  | 'spades'
  | 'energy'
  | 'diamonds'
  | 'clubs'
  | 'steel'
/** Rohstoffe (gameRules §2.2). */
export type RawSuit = 'hearts' | 'spades' | 'energy'
/** Endprodukte: Mehl, Obst, Konfitüre. Obst braucht Saat; Konfitüre braucht Obst. */
export type ProductSuit = 'diamonds' | 'clubs' | 'steel'
export type Rank = 7 | 6 | 5 | 4 | 3 | 2

export const SUITS: Suit[] = [
  'energy',
  'hearts',
  'spades',
  'diamonds',
  'clubs',
  'steel',
]
export const RAW_SUITS: RawSuit[] = ['energy', 'hearts', 'spades']
export const PRODUCT_SUITS: ProductSuit[] = ['diamonds', 'clubs', 'steel']

export type PlayerId = 'white' | 'black' | 'red' | 'green'
/** Szenario legt die Spielerzahl fest (A = 1, sonst ≥ 2). */
export type ScenarioId = 'A' | 'B' | 'C' | 'D'

export type FieldKind =
  | 'source'
  | 'factory'
  | 'storage'
  /** Persönliches Erntefeld (eine Sorte als Ziel; nimmt alle drei Endprodukte). */
  | 'victory'
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
  /**
   * Quelle: Farbe.
   * Fabrik: Produktfarbe.
   * Persönlicher Schuppen: wenn gesetzt → spezialisiert (nur diese Sorte).
   */
  suit?: Suit
  /** Fabrik: benötigte Rohstoffe. */
  recipe?: Recipe
  /** Abweichende staatliche Startgebühr (Standard 1). */
  fee?: number
  /** Zeile: 0 Quellen, 1 Fabriken|Infrastruktur. */
  row: number
}

export interface ScenarioDef {
  id: ScenarioId
  name: string
  players: PlayerId[]
  description: string
  fields: ScenarioField[]
  /** Persönliche Schuppen je Spieler (immer 1). */
  beetsPerPlayer: number
  /** Karten je Sorte im Nachziehstapel (Start). */
  cardsPerSuit: number
}

export interface FieldState {
  id: FieldId
  kind: FieldKind
  label: string
  /**
   * Quelle/Fabrik: Farbe.
   * Schuppen mit suit: nur diese Sorte (Fass, Silo, …).
   * Schuppen ohne suit: allgemeine Ablage.
   */
  suit?: Suit
  recipe?: Recipe
  row: number
  /**
   * Eigentümer (nach Kauf). Schuppen und Erntefeld immer persönlich; gekaufte
   * Felder und Küchen ebenfalls. Herrenlos = gemeinschaftlich, Gebühr 0.
   */
  owner?: Owner
  /** Nutzungsgebühr (nur bei Eigentümer). Geht an den Inhaber, nicht an die Bank. */
  fee: number
  /**
   * Offener Stapel (unten → oben).
   * Quelle: Vorrat.
   * Fabrik/Saatstand: Rezept-Eingang (Zutaten).
   * Persönlicher Schuppen: Umsortieren (ggf. nur eine Sorte).
   */
  stack: Card[]
  /**
   * Küche/Saatstand: Produkt-/Saat-Ausgabe.
   * Am Zugende erhält jeder Stapel eine offene Karte.
   * Überversorgung (>+5): Extra-Ausgabe, Bedarf → 0.
   */
  outputs?: Card[][]
  /**
   * Parallel zu `outputs`: wie viele Karten von oben je Stapel offen liegen.
   */
  outputsRevealed?: number[]
  /**
   * @deprecated Früheres Mehrspalten-Erntefeld; Erntefelder nutzen `stack`.
   */
  inputs?: Card[][]
  /**
   * Küche und Saatstand: Bedarfsmesser.
   * Szenario-Start sowie gekaufte Küchen: 0.
   * Lieferung/Eingang hebt und zahlt max(0, −Bedarf); Ausgabe senkt und kostet
   * max(0, −Bedarf). Am Zugende: unter −8 → Feld weg; über +5 → Extra-Stapel, Bedarf 0.
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
  /** @deprecated Frühere Markt-Lieferungen. */
  productsDelivered: number
  /** Felder mit Bedarfsmesser entfernt (unter −8). */
  marketCollapses: number
  sourceCollapses: number
  /** Durch Überversorgung (> +5) erzeugte Extra-Stapel / Extra-Eingänge. */
  marketsSpawned: number
  stacksClearedByAce: number
  /** Einkommen aus der Bank (Küchen- und Saatstand-Abrechnung). */
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
  /**
   * Aktuelle Kartenauswahl.
   * Bei Küche/Saatstand: `lane` wählt Eingang oder Ausgabe (Standard Ausgabe).
   * `stackIndex` wählt welchen Ausgabe- bzw. Erntespalten-Stapel (Default 0).
   */
  selection: {
    fieldId: FieldId
    count: number
    lane?: 'input' | 'output'
    stackIndex?: number
  } | null
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
  /** Laufende Nummer für gespawnte Feld-IDs. */
  marketSpawnSeq: number
  /** Start-Schuppen je Spieler (immer 1). */
  beetsPerPlayer: number
}

/** Schuppen und Erntefelder sind persönlich (nur Eigentümer nutzt sie). */
export function hasOwnership(kind: FieldKind): boolean {
  return kind === 'storage' || kind === 'victory'
}

/** Drei neutrale Erntefelder je Spieler. */
export const VICTORY_COLUMN_COUNT = 3
/**
 * Endprodukte, die zum Sieg auf den Erntefeldern sortiert sein müssen.
 * Die Felder selbst haben keine feste Sorte.
 */
export const VICTORY_COLUMN_SUITS: readonly ProductSuit[] = [
  'diamonds',
  'clubs',
  'steel',
]

export function victoryFieldId(playerId: PlayerId, index: number): FieldId {
  return `sieg-${playerId}-${index + 1}`
}

export function victoryColumnSuit(index: number): ProductSuit {
  return VICTORY_COLUMN_SUITS[index] ?? 'diamonds'
}

/** @deprecated Alias — bitte VICTORY_COLUMN_COUNT nutzen. */
export const VICTORY_ROW_COUNT = VICTORY_COLUMN_COUNT
/** Maximale Stapelhöhe auf einem Erntefeld. */
export const VICTORY_COLUMN_LENGTH = 6
/** @deprecated Alias — bitte VICTORY_COLUMN_LENGTH nutzen. */
export const VICTORY_ROW_LENGTH = VICTORY_COLUMN_LENGTH

/** Unterhalb davon verschwindet das Feld am Zugende. */
export const TENSION_MIN = -8
/**
 * Anzeige-Skala endet hier; darüber (>+5) kollabiert das Feld am Zugende.
 * Bei Bedarf &gt; 0 kann man eine Kopie gegen Bezahlung bauen.
 */
export const TENSION_MAX = 5
/** Kollaps, wenn Bedarf strikt größer als dieser Wert ist. */
export const OVERSUPPLY_COLLAPSE = 5
/** @deprecated Alias — früher Spawn-Schwelle, jetzt Kollaps. */
export const OVERSUPPLY_SPAWN = OVERSUPPLY_COLLAPSE
/** Neu gekaufte Felder/Kopien mit Bedarfsmesser starten bei −2 (Unterversorgung). */
export const BOUGHT_FIELD_START_DEMAND = -2

export function rankLabel(rank: Rank): string {
  return String(rank)
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return '🌱'
    case 'spades':
      return '🌾'
    case 'energy':
      return '💧'
    case 'diamonds':
      return '🥖'
    case 'clubs':
      return '🍎'
    case 'steel':
      return '🍯'
  }
}

export function suitName(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return 'Saat'
    case 'spades':
      return 'Getreide'
    case 'energy':
      return 'Wasser'
    case 'diamonds':
      return 'Mehl'
    case 'clubs':
      return 'Obst'
    case 'steel':
      return 'Konfitüre'
  }
}

/** Quellenbezeichnung (Regen / Feld). */
export function sourceLabel(suit: Suit, index?: number): string {
  const base =
    suit === 'hearts'
      ? 'Saatstand'
      : suit === 'spades'
        ? 'Getreidefeld'
        : suit === 'energy'
          ? 'Regen'
          : `${suitName(suit)}quelle`
  return index != null ? `${base} ${index}` : base
}

/** Anzahl offener Karten oben auf einem Ausgabestapel (Index, Default 0). */
export function outputRevealedCount(
  field: {
    outputs?: Card[][]
    outputsRevealed?: number[]
    /** @deprecated Legacy-Einzelstapel. */
    output?: Card[]
    outputRevealed?: number
  },
  stackIndex = 0,
): number {
  const stacks = field.outputs ?? (field.output ? [field.output] : [])
  const revealed =
    field.outputsRevealed ??
    (field.outputRevealed != null ? [field.outputRevealed] : [])
  const stack = stacks[stackIndex] ?? []
  const len = stack.length
  if (len === 0) return 0
  return Math.max(1, Math.min(len, revealed[stackIndex] ?? 1))
}

/** Saatstand: Eingang nimmt Obst, Ausgabe liefert Saat. */
export const SEED_BED_RECIPE: Recipe = { clubs: 1 }

/** Saatstand = Herz-Quelle mit Ausgabe + Bedarfsmesser. */
export function isSeedBed(field: { kind: string; suit?: Suit }): boolean {
  return field.kind === 'source' && field.suit === 'hearts'
}

/** Küche / Mühle für die Produktfarbe. */
export function factoryLabel(suit: Suit, letter?: string): string {
  const base =
    suit === 'diamonds'
      ? 'Mehlmühle'
      : suit === 'clubs'
        ? 'Beet'
        : suit === 'steel'
          ? 'Konfitürenküche'
          : `${suitName(suit)}küche`
  return letter ? `${base} ${letter}` : base
}

/**
 * Persönlicher Schuppen (Infrastruktur).
 * Ohne suit → allgemeiner Schuppen; mit suit → spezialisiert (Fass, Silo, …).
 */
export function storageLabel(suit?: Suit, index?: number): string {
  if (!suit) {
    return index != null ? `Schuppen ${index}` : 'Schuppen'
  }
  const base =
    suit === 'hearts'
      ? 'Saatkiste'
      : suit === 'spades'
        ? 'Getreidesilo'
        : suit === 'energy'
          ? 'Regentonne'
          : suit === 'diamonds'
            ? 'Mehlsack'
            : suit === 'clubs'
              ? 'Obstkiste'
              : suit === 'steel'
                ? 'Fass'
                : `${suitName(suit)}lager`
  return index != null ? `${base} ${index}` : base
}

export function isRawSuit(suit: Suit): suit is RawSuit {
  return suit === 'hearts' || suit === 'spades' || suit === 'energy'
}

export function isProductSuit(suit: Suit): suit is ProductSuit {
  return suit === 'diamonds' || suit === 'clubs' || suit === 'steel'
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
    steel: 0,
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

/**
 * Zwei-Zutaten-Küche: sobald beide Sorten mind. 1× liegen, zählt jede Karte
 * auf dem Eingang als eine Bedarfserfüllung; sonst 0 (Stapel bleibt liegen).
 */
export function dualIngredientFulfillments(
  cards: Card[],
  a: Suit,
  b: Suit,
): number {
  const counts = suitCounts(cards)
  if (counts[a] < 1 || counts[b] < 1) return 0
  return cards.length
}

/** Beet: Wasser + Saat. */
export function beetFulfillments(cards: Card[]): number {
  return dualIngredientFulfillments(cards, 'energy', 'hearts')
}

/** Konfitürenküche: Obst + Wasser. */
export function jamFulfillments(cards: Card[]): number {
  return dualIngredientFulfillments(cards, 'clubs', 'energy')
}

export function matchesRecipe(cards: Card[], recipe: Recipe): boolean {
  return recipeFulfillments(cards, recipe) >= 1
}

/**
 * Lieferlohn + Messer: nur bei Bedarf &lt; 0 gibt es Geld (= |Bedarf|).
 * Bei 0, +1, +2, … keine Belohnung; der Messer steigt trotzdem um 1.
 */
export function meterDeliveryPayout(meterBefore: number): {
  income: number
  meterAfter: number
} {
  return {
    income: meterBefore < 0 ? -meterBefore : 0,
    meterAfter: meterBefore + 1,
  }
}

/**
 * Ausgabe ziehen: Kosten nur bei Bedarf &lt; 0 (= |Bedarf|); bei 0, +1, +2, … gratis.
 * Danach Messer −1. Abliefern bei ≥ 0 bleibt ohne Belohnung.
 */
export function meterOutputDrawCost(meterBefore: number): {
  cost: number
  meterAfter: number
} {
  return {
    cost: Math.max(0, -meterBefore),
    meterAfter: meterBefore - 1,
  }
}

/** @deprecated Alias — gleiche Semantik. */
export const planetDeliveryPayout = meterDeliveryPayout

export function canStackOn(moving: Rank, targetTop: Rank): boolean {
  return moving === targetTop - 1
}
