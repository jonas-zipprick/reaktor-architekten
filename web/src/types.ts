export type Suit =
  | 'hearts'
  | 'energy'
  | 'clubs'
  | 'berry'
  | 'veg'
  | 'herb'
/** Rohstoffe. */
export type RawSuit = 'hearts' | 'energy'
/** Beet-Ernten: auf Erntefeldern und Markt. */
export type CropSuit = 'clubs' | 'berry' | 'veg' | 'herb'
/** Marktfähige Waren = Beet-Ernten. */
export type ProductSuit = CropSuit
export type Rank = 7 | 6 | 5 | 4 | 3 | 2

export const SUITS: Suit[] = [
  'energy',
  'hearts',
  'clubs',
  'berry',
  'veg',
  'herb',
]
export const RAW_SUITS: RawSuit[] = ['energy', 'hearts']
export const CROP_SUITS: CropSuit[] = ['clubs', 'berry', 'veg', 'herb']
export const PRODUCT_SUITS: ProductSuit[] = [...CROP_SUITS]

/** Vier private Beet-Arten je Spieler (Wasser + Saat → jeweilige Ernte). */
export type BeetKind = 'apfel' | 'beere' | 'gemuese' | 'kraut'

export const BEET_KINDS: readonly BeetKind[] = [
  'apfel',
  'beere',
  'gemuese',
  'kraut',
] as const

export type PlayerId = 'white' | 'black' | 'red' | 'green'
/** Verkaufspreise der Marktstände. */
export type MarketPrice = 2 | 4 | 6
export const MARKET_PRICES: readonly MarketPrice[] = [2, 4, 6] as const
/**
 * Preisanzeige-Werte der Messleiste über dem jeweiligen Stand.
 * 0 steht links neben dem 2T-Stand (kein Feld); 5…7 über dem 6T-Stand.
 */
export const MARKET_METER_MARKS: Record<MarketPrice, readonly number[]> = {
  2: [1, 2],
  4: [3, 4],
  6: [5, 6, 7],
}

/** Marktabnahme: Stand kaufbar wenn Preis ≤ aktuelle Preisanzeige. */
export function marketStallAffordable(
  price: MarketPrice,
  display: number,
): boolean {
  return display > 0 && price <= display
}
/** Szenario legt die Spielerzahl fest (A = 1, sonst ≥ 2). */
export type ScenarioId = 'A' | 'B' | 'C' | 'D'

export type FieldKind =
  | 'source'
  | 'factory'
  | 'storage'
  /** Persönliches Erntefeld (nimmt alle Beet-Ernten; Sorten mischbar). */
  | 'victory'
  /** Marktstand mit Festpreis (2/4/6T); gemeinsame Preisanzeige auf GameState. */
  | 'market'
export type FieldId = string
/** Betriebe gehören dem Staat oder einem Spieler. */
export type Owner = PlayerId | 'state'

export interface Card {
  id: string
  suit: Suit
  rank: Rank
  /** Besitzmarke: wer die Karte zuletzt auf den Markt gelegt hat. */
  marketPlacedBy?: PlayerId
}

/** Kartenanzahl je Farbe: Produktionsrezept einer Fabrik (♥/♠). */
export type Recipe = Partial<Record<Suit, number>>

export const BEET_DEFS: Record<
  BeetKind,
  { suit: CropSuit; label: string }
> = {
  apfel: { suit: 'clubs', label: 'Apfelbeet' },
  beere: { suit: 'berry', label: 'Beerenbeet' },
  gemuese: { suit: 'veg', label: 'Gemüsebeet' },
  kraut: { suit: 'herb', label: 'Kräuterbeet' },
}

/** Gemeinsames Beet-Rezept: Wasser + Saat. */
export const GARDEN_RECIPE: Recipe = { energy: 1, hearts: 1 }

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
   * Eigentümer. Schuppen, Erntefelder, Beete, Regen und Marktstände persönlich;
   * Herrenlos = gemeinschaftlich.
   */
  owner?: Owner
  /** @deprecated Nutzungsgebühren entfallen; bleibt 0. */
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
   * Saatstand/Wasserhandel: am Zugende +1 offene Karte je Ausgabestapel.
   * Persönliche Beete: starten leer; Zugende bei Wasser+Saat Eingang→Ausgabe.
   */
  outputs?: Card[][]
  /**
   * Parallel zu `outputs`: wie viele Karten von oben je Stapel offen liegen.
   */
  outputsRevealed?: number[]
  /**
   * @deprecated Früher mehrere Markteingänge; Marktstände nutzen nur `stack`.
   */
  inputs?: Card[][]
  /**
   * Marktstand: Verkaufspreis (2/4/6T). Abrechnung am Zugende laut
   * gemeinsamer `GameState.marketDemand` (Preisanzeige).
   */
  marketPrice?: MarketPrice
  /**
   * Preisanzeige (Saatstand, Wasserhandel — nicht Beete/Marktstände).
   * Ausgabe ziehen: Kosten = Anzeige (>0), danach +1 (max. 7).
   * Eingang abrechnen: Lohn = Anzeige (>0), danach −1 (min. 0).
   * Skala 0…7.
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
  /** @deprecated Kollaps entfernt — bleibt 0. */
  marketCollapses: number
  /** @deprecated */
  sourceCollapses: number
  /** @deprecated Extra-Stapel entfallen — bleibt 0. */
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
  /**
   * Zugende-Würfel: 2× Regen / 2× Markt / 2× Regen&Markt.
   * `endTurnDiceSeq` triggert die UI-Animation.
   */
  endTurnDice: 'rain' | 'market' | 'both' | null
  endTurnDiceSeq: number
  /** @deprecated Früher Kollaps-/Spawn-Flash. */
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
  /**
   * Gemeinsame Markt-Preisanzeige (über den drei Ständen 2/4/6T), Skala 0…7.
   * Bei Würfel „Markt“: zuerst +1, dann Kauf solange Anzeige &gt; 0 und Preis ≤ Anzeige.
   */
  marketDemand: number
  /** Start-Schuppen je Spieler (immer 1). */
  beetsPerPlayer: number
}

/** Schuppen und Erntefelder sind persönlich (nur Eigentümer nutzt sie). */
export function hasOwnership(kind: FieldKind): boolean {
  return kind === 'storage' || kind === 'victory'
}

/**
 * In der Partie produzierbare Beet-Ernten (nach Sitz / Spielerzahl).
 * Sitz 0 → Obst, 1 → Beeren, 2 → Gemüse, 3 → Kräuter.
 * Erntefelder nehmen trotzdem immer alle vier Sorten an.
 */
export function activeCropSuits(playerCount: number): CropSuit[] {
  const n = Math.max(1, Math.min(CROP_SUITS.length, Math.floor(playerCount)))
  return CROP_SUITS.slice(0, n)
}

/** Jeder Spieler hat immer genau drei Erntefelder. */
export const VICTORY_FIELDS_PER_PLAYER = 3

export function victoryColumnCount(_playerCount?: number): number {
  return VICTORY_FIELDS_PER_PLAYER
}

export function beetKindForSeat(seatIndex: number): BeetKind {
  return BEET_KINDS[Math.max(0, Math.min(BEET_KINDS.length - 1, seatIndex))]!
}

/** @deprecated Alias — bitte VICTORY_FIELDS_PER_PLAYER nutzen. */
export const VICTORY_COLUMN_COUNT = VICTORY_FIELDS_PER_PLAYER
/** @deprecated Alias — bitte CROP_SUITS / activeCropSuits nutzen. */
export const VICTORY_COLUMN_SUITS: readonly CropSuit[] = CROP_SUITS

export function victoryFieldId(playerId: PlayerId, index: number): FieldId {
  return `sieg-${playerId}-${index + 1}`
}

export function victoryColumnSuit(index: number): CropSuit {
  return CROP_SUITS[index] ?? 'clubs'
}

/** @deprecated Alias — bitte victoryColumnCount nutzen. */
export const VICTORY_ROW_COUNT = VICTORY_COLUMN_COUNT
/** Maximale Stapelhöhe auf einem Erntefeld. */
export const VICTORY_COLUMN_LENGTH = 6
/** @deprecated Alias — bitte VICTORY_COLUMN_LENGTH nutzen. */
export const VICTORY_ROW_LENGTH = VICTORY_COLUMN_LENGTH

/** Untergrenze der Preisanzeige (Depots und Markt). */
export const TENSION_MIN = 0
/** Obergrenze der Preisanzeige (Depots und Markt). */
export const TENSION_MAX = 7
/** @deprecated Alias für TENSION_MAX. */
export const OVERSUPPLY_COLLAPSE = TENSION_MAX
/** @deprecated Alias für TENSION_MAX. */
export const OVERSUPPLY_SPAWN = TENSION_MAX
/** @deprecated Keine käuflichen Felder mehr. */
export const BOUGHT_FIELD_START_DEMAND = -2

export function rankLabel(rank: Rank): string {
  return String(rank)
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return '🌱'
    case 'energy':
      return '💧'
    case 'clubs':
      return '🍎'
    case 'berry':
      return '🫐'
    case 'veg':
      return '🥕'
    case 'herb':
      return '🌿'
  }
}

export function suitName(suit: Suit): string {
  switch (suit) {
    case 'hearts':
      return 'Saat'
    case 'energy':
      return 'Wasser'
    case 'clubs':
      return 'Obst'
    case 'berry':
      return 'Beeren'
    case 'veg':
      return 'Gemüse'
    case 'herb':
      return 'Kräuter'
  }
}

/** Quellenbezeichnung (Regen / Saatstand). */
export function sourceLabel(suit: Suit, index?: number): string {
  const base =
    suit === 'hearts'
      ? 'Saatstand'
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

/**
 * Saatstand: Anzeige der akzeptierten Eingangs-Sorten (OR — jede Beet-Ernte
 * zählt 1× bei der Abrechnung, siehe `seedBedFulfillments`).
 */
export const SEED_BED_RECIPE: Recipe = {
  clubs: 1,
  berry: 1,
  veg: 1,
  herb: 1,
}

/** Saatstand: jede Beet-Ernte-Karte zählt als eine Erfüllung. */
export function seedBedFulfillments(cards: Card[]): number {
  return cards.filter((c) => isCropSuit(c.suit)).length
}

/** Wasserhandel: Eingang nimmt Wasser, Ausgabe liefert Wasser. */
export const WATER_TRADE_RECIPE: Recipe = { energy: 1 }

/** Feste ID des gemeinschaftlichen Wasserhandels. */
export const WATER_TRADE_FIELD_ID: FieldId = 'wasserhandel-1'

/** Saatstand = Herz-Quelle mit Ausgabe + Bedarfsmesser (gemeinschaftlich). */
export function isSeedBed(field: { kind: string; suit?: Suit }): boolean {
  return field.kind === 'source' && field.suit === 'hearts'
}

/**
 * Wasserhandel = Energie-Quelle mit Ausgabe + Bedarf (gemeinschaftlich).
 * Nicht der persönliche Regen.
 */
export function isWaterTrade(field: {
  id?: string
  kind: string
  suit?: Suit
}): boolean {
  return (
    field.kind === 'source' &&
    field.suit === 'energy' &&
    (field.id === WATER_TRADE_FIELD_ID ||
      (typeof field.id === 'string' && field.id.startsWith('wasserhandel-')))
  )
}

/** Gemeinschaftliches Depot mit Bedarf (Saatstand oder Wasserhandel). */
export function isCommunalDepot(field: {
  id?: string
  kind: string
  suit?: Suit
}): boolean {
  return isSeedBed(field) || isWaterTrade(field)
}

/** Beet = private Gartenküche (Wasser + Saat → Beet-Ernte). */
export function isBeet(field: { kind: string; suit?: Suit }): boolean {
  return field.kind === 'factory' && !!field.suit && isCropSuit(field.suit)
}

/** Regen = persönliche Wasser-Quelle (kein Wasserhandel). */
export function isRegen(field: {
  id?: string
  kind: string
  suit?: Suit
}): boolean {
  return (
    field.kind === 'source' && field.suit === 'energy' && !isWaterTrade(field)
  )
}

/**
 * Persönliches Beet — nur Eigentümer, kein Bedarfsmesser,
 * Produktion am Zugende nur bei mind. 1 Wasser + 1 Saat.
 */
export function isPersonalGarden(field: {
  kind: string
  suit?: Suit
}): boolean {
  return isBeet(field)
}

/**
 * Private Felder: Schuppen, Ernte, Beet, Regen —
 * nur der Eigentümer darf ablegen oder nehmen.
 */
export function isOwnerOnlyField(field: {
  kind: FieldKind | string
  suit?: Suit
}): boolean {
  return (
    hasOwnership(field.kind as FieldKind) ||
    isPersonalGarden(field) ||
    isRegen(field)
  )
}

export function beetFieldId(playerId: PlayerId, kind: BeetKind): FieldId {
  return `beet-${kind}-${playerId}`
}

export function regenFieldId(playerId: PlayerId): FieldId {
  return `regen-${playerId}`
}

/** Marktstand (Preis 2/4/6, gemeinsamer Bedarf). */
export function isMarketField(field: { kind: string }): boolean {
  return field.kind === 'market'
}

/** Drei gemeinsame Marktstände: `markt-2`, `markt-4`, `markt-6`. */
export function marketFieldId(price: MarketPrice): FieldId {
  return `markt-${price}`
}

/** @deprecated Alias — bitte marketFieldId(2) nutzen. */
export const MARKET_FIELD_ID: FieldId = 'markt-2'

/**
 * Beet-Ernte → Sitzplatz-Spieler (0 Obst, 1 Beeren, 2 Gemüse, 3 Kräuter).
 * Fehlt der Sitz in der Partie, gibt es keinen Empfänger.
 */
export function playerIdForCropSuit(
  players: { id: PlayerId }[],
  suit: Suit,
): PlayerId | null {
  if (!isCropSuit(suit)) return null
  const idx = CROP_SUITS.indexOf(suit)
  if (idx < 0 || idx >= players.length) return null
  return players[idx]!.id
}

/** Beet-Label für die Produktfarbe. */
export function factoryLabel(suit: Suit, letter?: string): string {
  const beet = (Object.values(BEET_DEFS) as { suit: CropSuit; label: string }[])
    .find((d) => d.suit === suit)
  const base = beet ? beet.label : `${suitName(suit)}beet`
  return letter ? `${base} ${letter}` : base
}

/**
 * Persönlicher Schuppen (Infrastruktur).
 * Ohne suit → allgemeiner Schuppen; mit suit → spezialisiert.
 */
export function storageLabel(suit?: Suit, index?: number): string {
  if (!suit) {
    return index != null ? `Schuppen ${index}` : 'Schuppen'
  }
  const base =
    suit === 'hearts'
      ? 'Saatkiste'
      : suit === 'energy'
        ? 'Regentonne'
        : suit === 'clubs'
          ? 'Obstkiste'
          : suit === 'berry'
            ? 'Beerenkiste'
            : suit === 'veg'
              ? 'Gemüsekiste'
              : suit === 'herb'
                ? 'Kräuterbund'
                : `${suitName(suit)}lager`
  return index != null ? `${base} ${index}` : base
}

export function isRawSuit(suit: Suit): suit is RawSuit {
  return suit === 'hearts' || suit === 'energy'
}

export function isCropSuit(suit: Suit): suit is CropSuit {
  return (
    suit === 'clubs' ||
    suit === 'berry' ||
    suit === 'veg' ||
    suit === 'herb'
  )
}

export function isProductSuit(suit: Suit): suit is ProductSuit {
  return isCropSuit(suit)
}

/** Marktware: Beet-Ernten und Saat (kein Wasser). */
export function isMarketTradableSuit(suit: Suit): boolean {
  return isCropSuit(suit) || suit === 'hearts'
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
    energy: 0,
    clubs: 0,
    berry: 0,
    veg: 0,
    herb: 0,
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

export function matchesRecipe(cards: Card[], recipe: Recipe): boolean {
  return recipeFulfillments(cards, recipe) >= 1
}

/**
 * Eingangs-Abrechnung: nur bei Preisanzeige &gt; 0 gibt es Taler (= Anzeige).
 * Danach Anzeige −1, aber nicht unter 0.
 */
export function meterDeliveryPayout(meterBefore: number): {
  income: number
  meterAfter: number
} {
  const capped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, meterBefore))
  return {
    income: capped > 0 ? capped : 0,
    meterAfter: Math.max(TENSION_MIN, capped - 1),
  }
}

/**
 * Ausgabe ziehen: Kosten nur bei Preisanzeige &gt; 0 (= Anzeige); bei 0 gratis.
 * Danach Anzeige +1, aber nicht über 7.
 */
export function meterOutputDrawCost(meterBefore: number): {
  cost: number
  meterAfter: number
} {
  const capped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, meterBefore))
  return {
    cost: Math.max(0, capped),
    meterAfter: Math.min(TENSION_MAX, capped + 1),
  }
}

/** @deprecated Alias — gleiche Semantik. */
export const planetDeliveryPayout = meterDeliveryPayout

export function canStackOn(moving: Rank, targetTop: Rank): boolean {
  return moving === targetTop - 1
}
