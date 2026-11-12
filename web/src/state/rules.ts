import type {
  Card,
  FieldId,
  FieldState,
  GameState,
  Owner,
  PlayerId,
  PlayerState,
  RawSuit,
  Recipe,
  Suit,
} from '../types'
import {
  canStackOn,
  isProductSuit,
  isRawSuit,
  matchesRecipe,
  meterDeliveryPayout,
  rankLabel,
  recipeFulfillments,
  recipeSuits,
  suitCounts,
  suitName,
  suitSymbol,
  hasOwnership,
  MARKET_EXP_TO_SPAWN,
  SUITS,
  TENSION_MIN,
} from '../types'
import { recipeForFactory, ROW } from '../data/scenarios'
import { createRng, shuffle } from './rng'

/** Quelle kollabiert bei mehr als so vielen Karten. */
const SOURCE_STACK_LIMIT = 8

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function log(
  state: GameState,
  text: string,
  tone: GameState['log'][0]['tone'] = 'info',
): void {
  state.logSeq += 1
  state.log.unshift({ id: state.logSeq, text, tone })
  if (state.log.length > 80) state.log.length = 80
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex]!
}

/** Einspieler-Szenario: keine Auktionen/Schenken/Gebühren ändern. */
export function isSinglePlayer(state: GameState): boolean {
  return state.players.length === 1
}

function playerById(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id)
}

/**
 * Würfel und Mischen hängen nur von Seed + bisherigem Verlauf ab, damit
 * aufgezeichnete Partien exakt nachspielbar bleiben.
 */
function rngFrom(state: GameState, salt = 0): () => number {
  return createRng(
    state.rngSeed + state.logSeq * 9973 + state.turn * 131 + salt * 7919,
  )
}

export type Payment = { to: PlayerId | 'bank'; amount: number }

function topCard(field: FieldState): Card | undefined {
  return field.stack[field.stack.length - 1]
}

export function describeCard(c: Card): string {
  const base = `${suitSymbol(c.suit)}${rankLabel(c.rank)}`
  return base
}

function meterLabel(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function fieldMeter(field: FieldState): number {
  return field.demand ?? 0
}

function setFieldMeter(field: FieldState, value: number): void {
  field.demand = value
}

/**
 * Fabrik hält Fertigware (Produktionsausgabe), ggf. mit Ablagekarten darüber.
 * Solange das gilt: keine Rohstoffzufuhr, keine neue Produktion.
 */
export function factoryHasOutput(field: FieldState): boolean {
  if (field.kind !== 'factory') return false
  return field.stack.some((c) => isProductSuit(c.suit))
}

/** Oberstes Fertigprodukt — null, wenn oben eine Ablage liegt oder leer. */
export function factoryProduct(field: FieldState): Card | null {
  if (field.kind !== 'factory') return null
  const top = topCard(field)
  return top && isProductSuit(top.suit) ? top : null
}

/**
 * Produktionsbereit (gameRules §6.3): mindestens eine volle Rezeptmenge,
 * kein Fertigprodukt auf der Fabrik. Mehrfache Erfüllung → mehrere Produkte.
 */
export function isProductionReady(field: FieldState): boolean {
  if (field.kind !== 'factory' || !field.recipe) return false
  if (factoryHasOutput(field)) return false
  return recipeFulfillments(field.stack, field.recipe) >= 1
}

/** Geplante Produktanzahl bei Zugende (0 wenn nicht produktionsbereit). */
export function plannedProductions(field: FieldState): number {
  if (!isProductionReady(field) || !field.recipe) return 0
  return recipeFulfillments(field.stack, field.recipe)
}

/**
 * Rohstoffstapel kann sein Rezept nicht mehr erfüllen (Rangfolge reicht nicht
 * für die noch fehlenden Karten) — nur Abheben oder ein Ass hilft.
 */
export function isFactoryBlocked(field: FieldState): boolean {
  if (field.kind !== 'factory' || !field.recipe) return false
  if (factoryHasOutput(field) || field.stack.length === 0) return false
  return !canStillComplete(field.stack, field.recipe)
}

/**
 * Ob ein Stapel sein Rezept noch erreichen kann (ohne Asse).
 * Überzählige Rohstoffe sind erlaubt und zählen nicht als Blockade.
 */
export function canStillComplete(
  stack: Card[],
  recipe: NonNullable<FieldState['recipe']>,
): boolean {
  if (matchesRecipe(stack, recipe)) return true
  const counts = suitCounts(stack)
  let missing = 0
  for (const suit of SUITS) {
    missing += Math.max(0, (recipe[suit] ?? 0) - counts[suit])
  }
  if (missing === 0) return true
  const top = stack[stack.length - 1]
  if (!top) return true
  // Weitere Karten: genau einen Rang tiefer bis mind. Ass (Rang 1).
  return top.rank - missing >= 1
}

/** Oberste zugängliche Karte, die von diesem Feld bewegt werden darf. */
export function movableCard(
  state: GameState,
  fieldId: FieldId,
): Card | null {
  const field = state.fields[fieldId]
  if (!field || state.ended) return null
  // Markt-Lieferungen bleiben bis Zugende liegen.
  if (field.kind === 'market') return null
  return topCard(field) ?? null
}

/**
 * Länge der absteigenden Folge von oben (jede Karte genau einen Rang
 * niedriger als die darunter). Mindestens 1, wenn der Stapel nicht leer ist.
 */
export function maxRunFromTop(stack: Card[]): number {
  if (!stack.length) return 0
  let n = 1
  for (let i = stack.length - 1; i > 0; i--) {
    const upper = stack[i]!
    const lower = stack[i - 1]!
    if (upper.rank !== lower.rank - 1) break
    n += 1
  }
  return n
}

/** Oberste `count` Karten (unten → oben in der Auswahl). */
export function selectedPacket(stack: Card[], count: number): Card[] {
  const n = Math.max(1, Math.min(count, stack.length))
  return stack.slice(stack.length - n)
}

/** Gebühr nur für Infrastruktur (Lager); eigene Lager sind kostenlos. */
function usageFee(field: FieldState, mover: PlayerId): Payment | null {
  if (!hasOwnership(field.kind)) return null
  if (!field.owner || field.owner === mover || field.fee <= 0) return null
  return {
    to: field.owner === 'state' ? 'bank' : field.owner,
    amount: field.fee,
  }
}

function mergePayments(payments: (Payment | null)[]): Payment[] {
  const agg = new Map<Payment['to'], number>()
  for (const p of payments) {
    if (!p || p.amount <= 0) continue
    agg.set(p.to, (agg.get(p.to) ?? 0) + p.amount)
  }
  return [...agg.entries()].map(([to, amount]) => ({ to, amount }))
}

function fitsOnStack(card: Card, field: FieldState): boolean {
  const top = topCard(field)
  return !top || canStackOn(card.rank, top.rank)
}

export type MoveKind =
  /** Rohstoff von einer Quelle auf eine Fabrik. */
  | 'supply'
  /** Rohstoff von Fabrik/Lager zu Fabrik (oder Rohstoff vom Lager auf eine Fabrik). */
  | 'shift'
  /** Fertigprodukt auf einen Planeten. */
  | 'deliver'
  /** Beliebige Karte auf ein Lager (Umsortieren). */
  | 'park'

export interface MoveCheck {
  ok: boolean
  reason?: string
  kind?: MoveKind
  /** Unterste Karte des bewegten Teilstapels (legt zuerst auf). */
  card?: Card
  /** Anzahl bewegter Karten. */
  count: number
  /** Summe aller Gebühren dieser Bewegung. */
  cost: number
  payments: Payment[]
  /** Planeteneinkommen laut Bedarfsmesser (nur Lieferungen). */
  income: number
  /** Bedarfsmesser nach der Lieferung. */
  meterAfter?: number
  /** Farbe des belieferten Markts. */
  meterSuit?: Suit
}

function fail(reason: string, partial: Partial<MoveCheck> = {}): MoveCheck {
  return {
    ok: false,
    reason,
    cost: 0,
    payments: [],
    income: 0,
    count: partial.count ?? 1,
    ...partial,
  }
}

/**
 * Prüft eine Kartenbewegung (gameRules §4.2) inkl. Gebühren, ohne den
 * Spielstand zu verändern. `count` = absteigender Teilstapel von oben.
 */
export function checkMove(
  state: GameState,
  fromId: FieldId,
  toId: FieldId,
  count = 1,
): MoveCheck {
  if (state.ended) return fail('Partie beendet')
  const from = state.fields[fromId]
  const to = state.fields[toId]
  if (!from || !to) return fail('Unbekanntes Feld')
  if (fromId === toId) return fail('Gleiches Feld')
  if (from.kind === 'market') {
    return fail('Karten bleiben bis Zugende auf dem Markt')
  }
  const max = maxRunFromTop(from.stack)
  if (max < 1) return fail('Keine Karte zum Bewegen')
  const n = Math.floor(count)
  if (n < 1 || n > max) {
    return fail('Ungültige Teilstapelhöhe', { count: n })
  }
  const packet = selectedPacket(from.stack, n)
  // Erste Karte, die auf dem Ziel landet (= unterste der Auswahl).
  const lead = packet[0]!

  const mover = currentPlayer(state)
  let kind: MoveKind
  let payments: Payment[]
  let income = 0
  let meterAfter: number | undefined
  let meterSuit: Suit | undefined

  if (!fitsOnStack(lead, to)) {
    return fail('Karte muss genau einen Rang niedriger sein', { count: n })
  }

  const allRaw = packet.every((c) => isRawSuit(c.suit))
  const allProduct = packet.every((c) => isProductSuit(c.suit))

  if (to.kind === 'storage' || to.kind === 'source') {
    // Quellen und Lager: Ablage jeder Farbe (Rangfolge); Quellen zählen zum Kollapslimit.
    kind = 'park'
    payments = mergePayments([
      from.kind === 'source' ||
      from.kind === 'storage' ||
      (from.kind === 'factory' && allProduct)
        ? usageFee(from, mover.id)
        : null,
    ])
  } else if (to.kind === 'factory' && factoryHasOutput(to)) {
    // Fertigware auf der Fabrik: Ablage jeder Farbe (Rangfolge), wie Quelle/Lager.
    kind = 'park'
    payments = mergePayments([
      from.kind === 'source' ||
      from.kind === 'storage' ||
      (from.kind === 'factory' && allProduct)
        ? usageFee(from, mover.id)
        : null,
    ])
  } else if (to.kind === 'market') {
    if (!to.suit) return fail('Markt ohne Farbe', { count: n })
    if (!packet.every((c) => c.suit === to.suit)) {
      return fail(`Nur ${suitName(to.suit)}-Karten`, { count: n })
    }
    kind = 'deliver'
    payments = mergePayments([
      from.kind === 'source' ||
      from.kind === 'storage' ||
      (from.kind === 'factory' && allProduct)
        ? usageFee(from, mover.id)
        : null,
      usageFee(to, mover.id),
    ])
    let meter = fieldMeter(to)
    for (const _c of packet) {
      const payout = meterDeliveryPayout(meter)
      income += payout.income
      meter = payout.meterAfter
    }
    meterAfter = meter
    meterSuit = to.suit
  } else if (allRaw) {
    if (to.kind !== 'factory') {
      return fail(
        'Rohstoffe gehören auf eine Fabrik, ein Lager, eine Quelle oder den passenden Markt',
        { count: n },
      )
    }
    if (factoryHasOutput(to)) {
      return fail('Erst Fertigprodukte freiräumen', { count: n })
    }
    if (from.kind === 'source' || from.kind === 'storage') {
      kind = from.kind === 'source' ? 'supply' : 'shift'
      payments = mergePayments([usageFee(from, mover.id)])
    } else {
      kind = 'shift'
      payments = []
    }
  } else if (allProduct) {
    return fail(
      'Fertigprodukte gehören auf einen Markt, ein Lager, eine Quelle oder auf Fabrik-Fertigware',
      { count: n },
    )
  } else {
    return fail('Gemischte Rohstoff-/Produktstapel nicht erlaubt', { count: n })
  }

  const cost = payments.reduce((s, p) => s + p.amount, 0)
  const result = {
    kind,
    card: lead,
    count: n,
    cost,
    payments,
    income,
    meterAfter,
    meterSuit,
  }
  // Lieferung: Einkommen kommt zuerst (Bargeld aus der Bank), Gebühren danach.
  const cashAfterIncome =
    kind === 'deliver'
      ? mover.money + Math.min(income, state.bank)
      : mover.money
  if (cashAfterIncome < cost) {
    const short = cost - cashAfterIncome
    const detail =
      kind === 'deliver' && income > 0
        ? `Gebühr ${cost}¤, Einkommen ${income}¤ — es fehlen ${short}¤`
        : `Nicht genug Geld (${cost}¤)`
    return fail(detail, result)
  }
  return { ok: true, ...result }
}

/** Alle Felder, auf die der Teilstapel von `fromId` gelegt werden darf. */
export function legalTargets(
  state: GameState,
  fromId: FieldId,
  count = 1,
): FieldId[] {
  if (!movableCard(state, fromId)) return []
  return Object.keys(state.fields).filter(
    (toId) => checkMove(state, fromId, toId, count).ok,
  )
}

function clearSelection(state: GameState): void {
  state.selection = null
  state.actionError = null
}

function failAction(state: GameState, reason: string): GameState {
  state.actionError = reason
  return state
}

function pay(state: GameState, payments: Payment[]): void {
  const player = currentPlayer(state)
  for (const p of payments) {
    player.money -= p.amount
    const other = p.to === 'bank' ? undefined : playerById(state, p.to)
    if (other) {
      other.money += p.amount
      state.stats.feesPaidToPlayers += p.amount
    } else {
      state.bank += p.amount
      state.stats.feesPaidToBank += p.amount
    }
  }
}

/**
 * Einkommen aus der Bank. Reicht die Bank nicht, wird der Rest zur
 * Bankforderung (gameRules §11.2). Gibt den bar gezahlten Betrag zurück.
 */
function payFromBank(state: GameState, amount: number): number {
  const player = currentPlayer(state)
  state.stats.marketIncome += amount
  if (amount <= state.bank) {
    state.bank -= amount
    player.money += amount
    return amount
  }
  const paid = state.bank
  state.bank = 0
  player.money += paid
  player.bankClaims += amount - paid
  return paid
}

function discard(state: GameState, cards: Card[]): void {
  for (const c of cards) state.decks[c.suit].discard.push(c)
}

/**
 * Oberste Karte des Nachziehstapels. Ist er leer, wird der Ablagestapel
 * derselben Farbe gemischt (gameRules §10.4).
 */
function drawCard(state: GameState, suit: Suit): Card | undefined {
  const deck = state.decks[suit]
  if (deck.draw.length === 0 && deck.discard.length > 0) {
    const n = deck.discard.length
    deck.draw = shuffle(deck.discard, rngFrom(state, SUITS.indexOf(suit) + 1))
    deck.discard = []
    log(state, `${suitName(suit)}-Ablage (${n}) neu gemischt.`, 'info')
  }
  return deck.draw.pop()
}

/**
 * Feld auswählen bzw. Teilstapelhöhe erhöhen (erneuter Klick auf dasselbe Feld).
 * Zykliert 1 → … → maxRun → 1.
 */
export function selectField(state: GameState, fieldId: FieldId): GameState {
  const next = cloneState(state)
  if (next.ended) return next
  if (!movableCard(next, fieldId)) {
    clearSelection(next)
    return next
  }
  const max = maxRunFromTop(next.fields[fieldId]!.stack)
  const prev = next.selection
  if (prev?.fieldId === fieldId) {
    next.selection = {
      fieldId,
      count: prev.count >= max ? 1 : prev.count + 1,
    }
  } else {
    next.selection = { fieldId, count: 1 }
  }
  next.actionError = null
  return next
}

/**
 * Bedarf bei Zugende: globaler Exp-Zähler / Spawn, dann −1 je Markt.
 */
function applyEndOfTurnDemand(state: GameState): void {
  if (state.ended) return

  const markets = Object.values(state.fields).filter((f) => f.kind === 'market')
  if (!markets.length) return

  advanceMarketExp(state)

  const afterSpawn = Object.values(state.fields).filter(
    (f) => f.kind === 'market',
  )
  const parts: string[] = []

  for (const market of afterSpawn) {
    const delta = -1
    const before = fieldMeter(market)
    const after = before + delta
    setFieldMeter(market, after)
    const sym = market.suit ? suitSymbol(market.suit) : '?'
    parts.push(
      `${market.label} ${meterLabel(delta)} → ${sym}${meterLabel(after)}`,
    )
  }

  state.demandRollSeq += 1
  state.demandRollFlash = parts
  state.demandRollIds = afterSpawn.map((p) => p.id)

  log(state, `Bedarf: ${parts.join('; ')}.`, 'tension')

  for (const market of afterSpawn) {
    collapseMarketIfOverLimit(state, market)
  }
}

/** Parent für die nächste Standard-Markterweiterung. */
function chooseSpawnParent(state: GameState): FieldState | null {
  const markets = Object.values(state.fields).filter((f) => f.kind === 'market')
  return markets[0] ?? null
}

/**
 * Globaler Exp-Zähler: +1 je Zugende; bei Schwellwert Spawn und Reset.
 */
function advanceMarketExp(state: GameState): void {
  state.marketExp += 1
  if (state.marketExp < MARKET_EXP_TO_SPAWN) return
  state.marketExp = 0
  if (state.scenarioId === 'A') {
    spawnScenarioAExpansion(state)
    return
  }
  const parent = chooseSpawnParent(state)
  if (!parent?.suit) return
  spawnSiblingMarket(state, parent)
}

/** Feld direkt hinter `afterId` in die Field-Map einfügen. */
function insertFieldAfter(
  state: GameState,
  afterId: FieldId,
  field: FieldState,
): void {
  const next: Record<string, FieldState> = {}
  let placed = false
  for (const [fid, existing] of Object.entries(state.fields)) {
    next[fid] = existing
    if (fid === afterId) {
      next[field.id] = field
      placed = true
    }
  }
  if (!placed) next[field.id] = field
  state.fields = next
}

const START_CARDS_PER_SPAWNED_SOURCE = 2

/**
 * Fehlende Rohstoffquelle nachziehen (z. B. Pik bei Markterweiterung).
 * Startet mit zwei Karten vom Nachziehstapel.
 */
function spawnSourceIfAbsent(
  state: GameState,
  suit: RawSuit,
): FieldState | null {
  const exists = Object.values(state.fields).some(
    (f) => f.kind === 'source' && f.suit === suit,
  )
  if (exists) return null

  state.marketSpawnSeq += 1
  const n =
    Object.values(state.fields).filter(
      (f) => f.kind === 'source' && f.suit === suit,
    ).length + 1
  const id = `quelle-${suit}-${state.marketSpawnSeq}`
  const label = `${suitName(suit)}quelle ${n}`
  const stack: Card[] = []
  for (let i = 0; i < START_CARDS_PER_SPAWNED_SOURCE; i++) {
    const card = drawCard(state, suit)
    if (card) stack.push(card)
  }
  const spawned: FieldState = {
    id,
    kind: 'source',
    suit,
    label,
    row: ROW.source,
    stack,
    fee: 0,
  }
  const anchor =
    [...Object.keys(state.fields)]
      .reverse()
      .find((fid) => state.fields[fid]!.kind === 'source') ??
    Object.keys(state.fields)[0]!
  insertFieldAfter(state, anchor, spawned)
  return spawned
}

/** Quellen für alle Rohstoffe im Rezept, die noch fehlen. */
function spawnMissingSourcesForRecipe(
  state: GameState,
  recipe: Recipe,
): FieldState[] {
  const spawned: FieldState[] = []
  const seen = new Set<Suit>()
  for (const suit of recipeSuits(recipe)) {
    if (!isRawSuit(suit) || seen.has(suit)) continue
    seen.add(suit)
    const s = spawnSourceIfAbsent(state, suit)
    if (s) spawned.push(s)
  }
  return spawned
}

function nextMarketLabel(state: GameState, suit: Suit): string {
  const n =
    Object.values(state.fields).filter(
      (f) => f.kind === 'market' && f.suit === suit,
    ).length + 1
  return n === 1
    ? `${suitName(suit)}markt`
    : `${suitName(suit)}markt ${n}`
}

function spawnMarketField(
  state: GameState,
  suit: Suit,
  afterId: FieldId,
): FieldState {
  state.marketSpawnSeq += 1
  const id = `markt-${suit}-${state.marketSpawnSeq}`
  const spawned: FieldState = {
    id,
    kind: 'market',
    suit,
    label: nextMarketLabel(state, suit),
    row: ROW.market,
    stack: [],
    fee: 0,
    demand: 0,
  }
  insertFieldAfter(state, afterId, spawned)
  state.stats.marketsSpawned += 1
  return spawned
}

function spawnFactoryField(
  state: GameState,
  suit: Suit,
): FieldState | null {
  if (!isProductSuit(suit)) return null
  const recipe = recipeForFactory(suit)
  if (!recipe) return null
  state.marketSpawnSeq += 1
  const factoryN =
    Object.values(state.fields).filter(
      (f) => f.kind === 'factory' && f.suit === suit,
    ).length + 1
  const letter = String.fromCharCode(64 + factoryN)
  const id = `fabrik-${suit}-${state.marketSpawnSeq}`
  const spawned: FieldState = {
    id,
    kind: 'factory',
    suit,
    label: `${suitName(suit)}fabrik ${letter}`,
    recipe,
    row: ROW.factory,
    stack: [],
    fee: 0,
  }
  const anchor =
    [...Object.keys(state.fields)]
      .reverse()
      .find((fid) => {
        const f = state.fields[fid]!
        return f.kind === 'factory' && f.suit === suit
      }) ??
    [...Object.keys(state.fields)]
      .reverse()
      .find((fid) => state.fields[fid]!.kind === 'factory') ??
    Object.keys(state.fields)[0]!
  insertFieldAfter(state, anchor, spawned)
  return spawned
}

function flashExpansion(
  state: GameState,
  headline: string,
  parts: string[],
  focusId: FieldId,
): void {
  const note = parts.join(', ')
  state.planetLimitSeq += 1
  state.planetLimitFlash = note ? `${headline} → ${note}` : headline
  state.planetLimitId = focusId
  log(
    state,
    note
      ? `Expansion — neu: ${note}.`
      : `Expansion — ${headline}.`,
    'market',
  )
}

/**
 * Szenario A Ausbaustufen:
 * 1) Energiemarkt
 * 2) Pikquelle + Karofabrik + Karomarkt
 * danach: Standard (gleichfarbiger Markt + ggf. Fabrik)
 */
function spawnScenarioAExpansion(state: GameState): void {
  const step = state.stats.marketsSpawned
  const anchor =
    Object.values(state.fields).find((f) => f.kind === 'market')?.id ??
    Object.keys(state.fields)[0]!

  if (step === 0) {
    const market = spawnMarketField(state, 'energy', anchor)
    flashExpansion(state, 'Ausbau 1', [market.label], market.id)
    return
  }

  if (step === 1) {
    const parts: string[] = []
    const pik = spawnSourceIfAbsent(state, 'spades')
    if (pik) parts.push(pik.label)
    const factory = spawnFactoryField(state, 'diamonds')
    if (factory) parts.push(factory.label)
    const market = spawnMarketField(state, 'diamonds', anchor)
    parts.push(market.label)
    flashExpansion(state, 'Ausbau 2', parts, market.id)
    return
  }

  const parent = chooseSpawnParent(state)
  if (!parent?.suit) return
  spawnSiblingMarket(state, parent)
}

function spawnSiblingMarket(state: GameState, parent: FieldState): void {
  if (!parent.suit) return

  const spawnedMarket = spawnMarketField(state, parent.suit, parent.id)
  const extras: string[] = [spawnedMarket.label]

  if (isProductSuit(parent.suit)) {
    const factory = spawnFactoryField(state, parent.suit)
    if (factory) {
      extras.push(factory.label)
      const recipe = recipeForFactory(parent.suit)
      if (recipe) {
        for (const src of spawnMissingSourcesForRecipe(state, recipe)) {
          extras.push(src.label)
        }
      }
    }
  }

  flashExpansion(state, parent.label, extras, spawnedMarket.id)
}

/**
 * Markt-Messer unter −8: Kollaps — Stapel weg, Messer 0, Exp-Zähler 0.
 */
function collapseMarketIfOverLimit(state: GameState, market: FieldState): void {
  if (market.kind !== 'market') return
  if (fieldMeter(market) >= TENSION_MIN) return

  const label = meterLabel(fieldMeter(market))
  state.planetLimitSeq += 1
  state.planetLimitFlash = `${market.label}: ${label}`
  state.planetLimitId = market.id
  log(
    state,
    `${market.label}: Bedarf ${label} — Markt kollabiert (Messer 0).`,
    'tension',
  )

  discard(state, market.stack)
  market.stack = []
  market.demand = 0
  state.marketExp = 0
  state.stats.marketCollapses += 1
}

/**
 * Quelle mit mehr als 8 Karten: Stapel weg.
 */
function collapseSourceIfOverloaded(
  state: GameState,
  source: FieldState,
): void {
  if (source.kind !== 'source') return
  if (source.stack.length <= SOURCE_STACK_LIMIT) return

  const n = source.stack.length
  state.planetLimitSeq += 1
  state.planetLimitFlash = `${source.label}: ${n} Karten`
  state.planetLimitId = source.id
  log(
    state,
    `${source.label}: ${n} Karten — Quelle kollabiert (Stapel weg).`,
    'tension',
  )

  discard(state, source.stack)
  source.stack = []
  state.stats.sourceCollapses += 1
}

function checkEndConditions(state: GameState): void {
  if (state.ended) return
  if (state.bank <= 0) endGame(state, 'Die Bank ist leer.')
}

function endGame(state: GameState, reason: string): void {
  if (state.ended) return
  state.ended = true
  clearSelection(state)

  const scored = state.players
    .map((p) => ({ p, score: totalWealth(p) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]!.score
  const winners = scored.filter((s) => s.score === best)
  state.winnerText =
    winners.length > 1
      ? `Geteilter Sieg: ${winners.map((w) => w.p.name).join(', ')} (${best}). ${reason}`
      : `${winners[0]!.p.name} gewinnt mit Gesamtvermögen ${best}. ${reason}`
  log(state, state.winnerText, 'end')
}

/** Spieler mit dem höchsten Gesamtvermögen (mehrere bei Gleichstand). */
export function leaders(state: GameState): PlayerState[] {
  const best = Math.max(...state.players.map(totalWealth))
  return state.players.filter((p) => totalWealth(p) === best)
}

/**
 * Teilstapel von `fromId` nach `toId` teleportieren. Kostet keine Aktion
 * und beendet den Zug nicht; fällige Gebühren werden sofort bezahlt.
 */
export function executeMove(
  state: GameState,
  fromId: FieldId,
  toId: FieldId,
  count = 1,
): GameState {
  const next = cloneState(state)
  next.actionError = null
  if (next.ended) return next

  const check = checkMove(next, fromId, toId, count)
  if (!check.ok) return failAction(next, check.reason ?? 'Ungültige Bewegung')

  const player = currentPlayer(next)
  const from = next.fields[fromId]!
  const to = next.fields[toId]!
  const n = check.count
  const packet = from.stack.splice(from.stack.length - n, n)
  const costNote = check.cost > 0 ? ` (−${check.cost}¤ Gebühr)` : ''
  const packetNote =
    n > 1 ? ` (${n} Karten: ${packet.map(describeCard).join(' ')})` : ''

  if (check.kind === 'deliver') {
    for (const card of packet) to.stack.push(card)
    if (check.meterAfter != null) setFieldMeter(to, check.meterAfter)
    next.stats.productsDelivered += packet.length
    // Zuerst Einkommen, danach Abhol- und Liefergebühr.
    const paid = payFromBank(next, check.income)
    pay(next, check.payments)
    const claim = check.income - paid
    const incomeNote =
      check.income > 0
        ? `, +${paid}¤ Einkommen${claim > 0 ? ` und ${claim} Bankforderung` : ''}`
        : ''
    const meterNote = check.meterSuit
      ? ` — ${suitSymbol(check.meterSuit)}${meterLabel(check.meterAfter ?? 0)}`
      : ''
    log(
      next,
      `${player.name} liefert${packetNote || ` ${describeCard(packet[0]!)}`} von ${from.label} an ${to.label}${incomeNote}${costNote}${meterNote}.`,
      'money',
    )

    checkEndConditions(next)
    if (to.kind === 'market') collapseMarketIfOverLimit(next, to)
  } else {
    pay(next, check.payments)
    for (const card of packet) to.stack.push(card)
    log(
      next,
      `${player.name} legt${packetNote || ` ${describeCard(packet[0]!)}`} von ${from.label} auf ${to.label}${costNote}.`,
      'info',
    )
    if (to.kind === 'source') collapseSourceIfOverloaded(next, to)
  }

  clearSelection(next)
  checkEndConditions(next)
  return next
}

/** Gebühr eines eigenen Lagers ändern (kostenlos, beliebig oft). */
export function setFee(
  state: GameState,
  fieldId: FieldId,
  fee: number,
): GameState {
  const next = cloneState(state)
  if (next.ended) return next
  if (isSinglePlayer(next)) {
    return failAction(next, 'Im Einspieler-Szenario bleiben Lager staatlich')
  }
  const player = currentPlayer(next)
  const field = next.fields[fieldId]
  if (!field || !hasOwnership(field.kind) || field.owner !== player.id) {
    return next
  }
  // Gebühren dürfen nicht negativ sein.
  field.fee = Math.max(0, Math.floor(fee))
  log(next, `${player.name} setzt die Gebühr von ${field.label} auf ${field.fee}.`)
  return next
}

/** Geld an einen Mitspieler verschenken (gameRules §10.2). */
export function executeGift(
  state: GameState,
  to: PlayerId,
  amount: number,
): GameState {
  const next = cloneState(state)
  next.actionError = null
  if (next.ended) return next
  if (isSinglePlayer(next)) {
    return failAction(next, 'Im Einspieler-Szenario gibt es niemanden zum Beschenken')
  }
  const player = currentPlayer(next)
  const receiver = playerById(next, to)
  if (!receiver || receiver.id === player.id) {
    return failAction(next, 'Kein gültiger Empfänger')
  }
  if (!Number.isInteger(amount) || amount < 1) {
    return failAction(next, 'Betrag muss mindestens 1¤ sein')
  }
  if (player.money < amount) {
    return failAction(next, `Nicht genug Geld (${amount}¤)`)
  }
  player.money -= amount
  receiver.money += amount
  log(next, `${player.name} schenkt ${receiver.name} ${amount}¤.`, 'market')
  return next
}

export interface AuctionInfo {
  ok: boolean
  reason?: string
  /** Bisheriger Eigentümer: Staat (Privatisierung) oder aktiver Spieler. */
  seller?: Owner
  /** Wer mitbieten darf. */
  bidders: PlayerId[]
}

/**
 * Darf der aktive Spieler dieses Lager zur Auktion stellen?
 * Nur Infrastruktur (Lager) ist auktionierbar.
 */
export function auctionInfo(state: GameState, fieldId: FieldId): AuctionInfo {
  const none = (reason: string): AuctionInfo => ({
    ok: false,
    reason,
    bidders: [],
  })
  if (state.ended) return none('Partie beendet')
  if (isSinglePlayer(state)) {
    return none('Im Einspieler-Szenario gibt es keine Auktionen')
  }
  const field = state.fields[fieldId]
  if (!field) return none('Unbekanntes Feld')
  if (!hasOwnership(field.kind)) {
    return none('Nur Lager können auktioniert werden')
  }
  if (state.auctionUsed) {
    return none('Pro Zug nur eine Auktion')
  }
  const player = currentPlayer(state)
  if (field.owner === 'state') {
    return {
      ok: true,
      seller: 'state',
      bidders: state.players.map((p) => p.id),
    }
  }
  if (field.owner === player.id) {
    return {
      ok: true,
      seller: player.id,
      bidders: state.players.filter((p) => p.id !== player.id).map((p) => p.id),
    }
  }
  return none('Fremde Lager können nicht zur Auktion gestellt werden')
}

/**
 * Ergebnis einer offenen Auktion verbuchen (gameRules §9.2–9.5).
 * `winner === null`: kein Gebot — der Betrieb bleibt beim bisherigen Eigentümer.
 * `fee`: Gebühr, die der neue Eigentümer unmittelbar nach dem Erwerb festlegt.
 * Zählt in jedem Fall als die eine Auktion dieses Zuges.
 */
export function executeAuction(
  state: GameState,
  fieldId: FieldId,
  winner: PlayerId | null,
  price: number,
  fee?: number,
): GameState {
  const next = cloneState(state)
  next.actionError = null
  const info = auctionInfo(next, fieldId)
  if (!info.ok) return failAction(next, info.reason ?? 'Auktion nicht möglich')

  const player = currentPlayer(next)
  const field = next.fields[fieldId]!
  const sellerName =
    info.seller === 'state' ? 'der Staat' : player.name

  if (winner === null) {
    next.auctionUsed = true
    log(
      next,
      `${player.name} stellt ${field.label} zur Auktion — kein Gebot, ${sellerName} behält den Betrieb.`,
      'market',
    )
    return next
  }

  const buyer = playerById(next, winner)
  if (!buyer || !info.bidders.includes(winner)) {
    return failAction(next, 'Dieser Spieler darf nicht mitbieten')
  }
  // Startgebot 1¤; geboten wird nur mit vorhandenem Bargeld.
  if (!Number.isInteger(price) || price < 1) {
    return failAction(next, 'Gebot muss mindestens 1¤ sein')
  }
  if (buyer.money < price) {
    return failAction(next, `${buyer.name} hat nicht genug Bargeld (${price}¤)`)
  }

  buyer.money -= price
  if (info.seller === 'state') {
    next.bank += price
  } else {
    player.money += price
  }
  field.owner = buyer.id
  if (fee != null) field.fee = Math.max(0, Math.floor(fee))
  next.auctionUsed = true
  next.stats.auctionsSold += 1
  next.stats.auctionVolume += price

  log(
    next,
    `Auktion ${field.label}: ${buyer.name} erhält den Zuschlag für ${price}¤ (${
      info.seller === 'state' ? 'an die Bank' : `an ${player.name}`
    }), Gebühr ${field.fee}.`,
    'market',
  )
  return next
}

function advanceTurn(state: GameState): void {
  clearSelection(state)
  state.auctionUsed = false
  state.currentPlayerIndex =
    (state.currentPlayerIndex + 1) % state.players.length
  if (state.currentPlayerIndex === state.startPlayerIndex) state.turn += 1
}

/**
 * Zugende „Karten ziehen und Produzieren“:
 * 1. Quellen ziehen nach; Überfüllung → Quellenkollaps.
 * 2. Produktionsbereite Fabriken produzieren.
 * 3. Exp-Spawn + Bedarf −1 je Markt; Kollapse.
 * 4. Lieferstapel auf Märkten abräumen.
 */
export function executeEndTurn(state: GameState): GameState {
  const next = cloneState(state)
  next.actionError = null
  if (next.ended) return next

  const player = currentPlayer(next)
  const fields = Object.values(next.fields)

  const drawn: string[] = []
  for (const source of fields) {
    if (source.kind !== 'source' || !source.suit) continue
    const card = drawCard(next, source.suit)
    if (!card) continue
    source.stack.push(card)
    drawn.push(describeCard(card))
  }
  for (const source of fields) {
    if (source.kind === 'source') collapseSourceIfOverloaded(next, source)
  }

  const produced: string[] = []
  next.producedIds = []
  for (const factory of fields) {
    if (!factory.suit || !factory.recipe || !isProductionReady(factory)) continue
    const times = recipeFulfillments(factory.stack, factory.recipe)
    const products: Card[] = []
    for (let i = 0; i < times; i++) {
      const product = drawCard(next, factory.suit)
      if (!product) break
      products.push(product)
    }
    if (!products.length) continue
    discard(next, factory.stack)
    factory.stack = products
    next.stats.productions += products.length
    next.producedIds.push(factory.id)
    produced.push(
      `${factory.label} → ${products.map(describeCard).join(' ')} (${products.length}×)`,
    )
  }

  log(
    next,
    `${player.name} beendet den Zug: Quellen erhalten ${drawn.length ? drawn.join(' ') : 'keine Karten'}.`,
    'info',
  )
  if (produced.length) {
    log(next, `Produktion: ${produced.join('; ')}.`, 'production')
  }

  applyEndOfTurnDemand(next)

  let cleared = 0
  for (const field of Object.values(next.fields)) {
    if (field.kind !== 'market') continue
    if (field.stack.length === 0) continue
    discard(next, field.stack)
    field.stack = []
    cleared += 1
  }
  if (cleared > 0) {
    log(next, `Lieferstapel abgeräumt: ${cleared} Markt-Stapel.`, 'info')
  }

  advanceTurn(next)
  checkEndConditions(next)
  return next
}

export function totalWealth(p: {
  money: number
  bankClaims: number
}): number {
  return p.money + p.bankClaims
}
