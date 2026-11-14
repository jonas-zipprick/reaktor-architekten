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
  factoryLabel as factoryTitle,
  isProductSuit,
  isRawSuit,
  isPointsSuit,
  marketLabel as marketTitle,
  matchesRecipe,
  meterDeliveryPayout,
  meterOutputDrawCost,
  rankLabel,
  recipeFulfillments,
  recipeLabel,
  beetFulfillments,
  sourceLabel as sourceTitle,
  suitCounts,
  suitName,
  suitSymbol,
  hasOwnership,
  isSeedBed,
  outputRevealedCount,
  withoutPoints,
  BOUGHT_FIELD_START_DEMAND,
  OVERSUPPLY_COLLAPSE,
  POINTS_SUIT,
  SEED_BED_RECIPE,
  SUITS,
  TENSION_MIN,
  VICTORY_COLUMN_COUNT,
  VICTORY_COLUMN_LENGTH,
} from '../types'
import {
  getScenario,
  personalBeetLabel,
  recipeForFactory,
  ROW,
} from '../data/scenarios'
import { FACTORY_OUTPUT_SIZE } from './factory'
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

function topOfCards(stack: Card[]): Card | undefined {
  return stack[stack.length - 1]
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

/** Feld mit Ausgabestapel (Küche, Saatstand oder Markt-Siegpunkte). */
export function hasOutputStack(field: FieldState): boolean {
  return (
    field.kind === 'factory' ||
    isSeedBed(field) ||
    field.kind === 'market'
  )
}

/** Farbe der Ausgabe: Markt → Siegpunkte, sonst Feld-Sorte. */
export function outputSuit(field: FieldState): Suit | undefined {
  if (field.kind === 'market') return POINTS_SUIT
  return field.suit
}

/** Alle Ausgabestapel (migriert Legacy-`output` bei Bedarf). */
export function factoryOutputs(field: FieldState): Card[][] {
  if (!hasOutputStack(field)) return []
  if (!field.outputs) {
    const legacy = (field as FieldState & { output?: Card[] }).output
    field.outputs = legacy ? [legacy] : [[]]
    const legacyRev = (field as FieldState & { outputRevealed?: number })
      .outputRevealed
    field.outputsRevealed = [
      legacyRev ?? (field.outputs[0]!.length > 0 ? 1 : 0),
    ]
    delete (field as FieldState & { output?: Card[] }).output
    delete (field as FieldState & { outputRevealed?: number }).outputRevealed
  }
  if (!field.outputsRevealed) {
    field.outputsRevealed = field.outputs.map((s) => (s.length > 0 ? 1 : 0))
  }
  while (field.outputsRevealed.length < field.outputs.length) {
    field.outputsRevealed.push(
      field.outputs[field.outputsRevealed.length]!.length > 0 ? 1 : 0,
    )
  }
  return field.outputs
}

/** Markteingänge (migriert Legacy-`stack` bei Bedarf). */
export function marketInputs(field: FieldState): Card[][] {
  if (field.kind !== 'market') return []
  if (!field.inputs) {
    field.inputs = [field.stack.length ? field.stack : []]
    field.stack = []
  }
  if (field.inputs.length === 0) field.inputs.push([])
  return field.inputs
}

/** Küche/Saatstand hat noch Karten auf irgendeinem Ausgabestapel. */
export function factoryHasOutput(field: FieldState): boolean {
  if (!hasOutputStack(field)) return false
  return factoryOutputs(field).some((s) => s.length > 0)
}

/** Oberste Karte einer Ausgabe (Default-Stapel 0). */
export function factoryProduct(
  field: FieldState,
  stackIndex = 0,
): Card | null {
  if (!hasOutputStack(field)) return null
  const out = factoryOutputs(field)[stackIndex]
  if (!out?.length) return null
  return out[out.length - 1] ?? null
}

/**
 * Darf die Karte auf den Eingang?
 * Nur Sorten, die im Rezept stehen (keine ★, keine Fremd-Rohstoffe).
 * Saatstand: nur Obst.
 */
export function canFeedFactory(card: Card, field: FieldState): boolean {
  if (isPointsSuit(card.suit)) return false
  if (isSeedBed(field)) {
    return card.suit === 'clubs'
  }
  if (field.kind !== 'factory' || !field.recipe) return false
  if (field.suit && card.suit === field.suit) return false
  return (field.recipe[card.suit] ?? 0) > 0
}

/** @deprecated Küchen produzieren nicht mehr am Zugende — Ausgabe ist der Vorrat. */
export function isProductionReady(_field: FieldState): boolean {
  return false
}

/** @deprecated */
export function plannedProductions(_field: FieldState): number {
  return 0
}

/**
 * Eingang kann sein Rezept nicht mehr erfüllen — nur Abheben hilft.
 */
export function isFactoryBlocked(field: FieldState): boolean {
  if (field.kind !== 'factory' || !field.recipe) return false
  if (field.stack.length === 0) return false
  return !canStillComplete(field.stack, field.recipe)
}

function factoryOutputStack(field: FieldState, stackIndex = 0): Card[] {
  const outs = factoryOutputs(field)
  const i = Math.max(0, Math.floor(stackIndex))
  while (outs.length <= i) {
    outs.push([])
    if (!field.outputsRevealed) field.outputsRevealed = []
    field.outputsRevealed.push(0)
  }
  return outs[i]!
}

/** Einen Ausgabestapel aus dem Deck der Produkt-/Saat-/VP-Farbe nachfüllen. */
function refillFactoryOutput(
  state: GameState,
  field: FieldState,
  stackIndex = 0,
): void {
  const suit = outputSuit(field)
  if (!hasOutputStack(field) || !suit) return
  const out = factoryOutputStack(field, stackIndex)
  while (out.length < FACTORY_OUTPUT_SIZE) {
    const card = drawCard(state, suit)
    if (!card) break
    out.push(card)
  }
}

/** Neuen vollen Ausgabestapel anlegen (Überversorgung; nicht Markt). */
function addFactoryOutputStack(state: GameState, field: FieldState): void {
  if (field.kind === 'market') return
  const suit = outputSuit(field)
  if (!hasOutputStack(field) || !suit) return
  const outs = factoryOutputs(field)
  const next: Card[] = []
  for (let i = 0; i < FACTORY_OUTPUT_SIZE; i++) {
    const card = drawCard(state, suit)
    if (!card) break
    next.push(card)
  }
  outs.push(next)
  if (!field.outputsRevealed) field.outputsRevealed = []
  field.outputsRevealed.push(next.length > 0 ? 1 : 0)
}

/** Neuen leeren Markteingang anlegen (Überversorgung). */
function addMarketInput(field: FieldState): void {
  marketInputs(field).push([])
}

/**
 * Ob ein Stapel sein Rezept noch erreichen kann.
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
  // Weitere Karten: genau einen Rang tiefer bis mind. 2.
  return top.rank - missing >= 2
}

export type StackLane = 'input' | 'output'

/** Effektive Spur: bei Küche/Saatstand Standard Ausgabe. */
export function resolveLane(
  field: FieldState,
  lane?: StackLane,
): StackLane | 'main' {
  if (!hasOutputStack(field)) return 'main'
  return lane === 'input' ? 'input' : 'output'
}

/** Die drei Siegpunkte-Spalten (migriert bei Bedarf). */
export function victoryColumns(field: FieldState): Card[][] {
  if (field.kind !== 'victory') return []
  if (!field.inputs || field.inputs.length === 0) {
    field.inputs = Array.from({ length: VICTORY_COLUMN_COUNT }, () => [])
  }
  while (field.inputs.length < VICTORY_COLUMN_COUNT) field.inputs.push([])
  return field.inputs
}

/** @deprecated Alias — bitte victoryColumns nutzen. */
export const victoryRows = victoryColumns

/**
 * Spalte vollständig: genau 6 ★-Karten absteigend 7→2.
 * (Haken / Sieg erst bei voller Spalte, nicht schon bei einzelner 2.)
 */
export function isVictoryColumnComplete(stack: Card[]): boolean {
  if (stack.length !== VICTORY_COLUMN_LENGTH) return false
  for (let i = 0; i < VICTORY_COLUMN_LENGTH; i++) {
    const card = stack[i]!
    if (!isPointsSuit(card.suit)) return false
    if (card.rank !== ((7 - i) as Card['rank'])) return false
  }
  return true
}

/** @deprecated Alias — bitte isVictoryColumnComplete nutzen. */
export const isVictoryRowComplete = isVictoryColumnComplete

/** Alle drei Spalten voll → Spieler hat gewonnen. */
export function isVictoryFieldComplete(field: FieldState): boolean {
  if (field.kind !== 'victory') return false
  return victoryColumns(field).every(isVictoryColumnComplete)
}

/** Stapel für die gewählte Spur / den gewählten Index. */
export function movableStack(
  field: FieldState,
  lane?: StackLane,
  stackIndex = 0,
): Card[] {
  if (field.kind === 'victory') {
    return (
      victoryColumns(field)[Math.max(0, stackIndex)] ??
      victoryColumns(field)[0]!
    )
  }
  if (field.kind === 'market') {
    const resolved = resolveLane(field, lane)
    if (resolved === 'output') return factoryOutputStack(field, stackIndex)
    return (
      marketInputs(field)[Math.max(0, stackIndex)] ?? marketInputs(field)[0]!
    )
  }
  const resolved = resolveLane(field, lane)
  if (resolved === 'output') return factoryOutputStack(field, stackIndex)
  return field.stack
}

/** Maximale Teilstapelhöhe der Spur. */
export function maxMovableRun(
  field: FieldState,
  lane?: StackLane,
  stackIndex = 0,
): number {
  if (field.kind === 'victory') {
    return maxRunFromTop(movableStack(field, undefined, stackIndex))
  }
  const resolved = resolveLane(field, lane)
  if (resolved === 'output') return maxRevealedOutputRun(field, stackIndex)
  if (field.kind === 'market' && resolved === 'input') {
    return maxRunFromTop(movableStack(field, 'input', stackIndex))
  }
  return maxRunFromTop(movableStack(field, lane, stackIndex))
}

/** Oberste zugängliche Karte (Ausgabe oder Eingang, falls vorhanden). */
export function movableCard(
  state: GameState,
  fieldId: FieldId,
  lane?: StackLane,
  stackIndex = 0,
): Card | null {
  const field = state.fields[fieldId]
  if (!field || state.ended) return null
  if (field.kind === 'victory') {
    const stack = movableStack(field, undefined, stackIndex)
    return stack[stack.length - 1] ?? null
  }
  if (hasOutputStack(field)) {
    if (lane === 'input') {
      if (field.kind === 'market') {
        const stack = movableStack(field, 'input', stackIndex)
        return stack[stack.length - 1] ?? null
      }
      return topCard(field) ?? null
    }
    if (lane === 'output') return factoryProduct(field, stackIndex)
    return factoryProduct(field, stackIndex) ?? (
      field.kind === 'market'
        ? (movableStack(field, 'input', stackIndex).at(-1) ?? null)
        : (topCard(field) ?? null)
    )
  }
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

/**
 * Ausgabe: absteigender Teilstapel von oben, nur so weit die Karten offen sind.
 */
export function maxRevealedOutputRun(
  field: FieldState,
  stackIndex = 0,
): number {
  if (!hasOutputStack(field)) return 0
  const stack = movableStack(field, 'output', stackIndex)
  if (!stack.length) return 0
  return Math.min(maxRunFromTop(stack), outputRevealedCount(field, stackIndex))
}

/** Oberste `count` Karten (unten → oben in der Auswahl). */
export function selectedPacket(stack: Card[], count: number): Card[] {
  const n = Math.max(1, Math.min(count, stack.length))
  return stack.slice(stack.length - n)
}

/**
 * Nutzungsgebühr des Eigentümers (nicht an die Bank).
 * Eigentümer selbst zahlt keine Gebühr.
 */
function usageFee(field: FieldState, mover: PlayerId): Payment | null {
  const owner = field.owner
  if (!owner || owner === 'state' || owner === mover) return null
  const amount = Math.max(0, Math.floor(field.fee))
  if (amount <= 0) return null
  return { to: owner, amount }
}

/** Bedarfspreis (Bank) + Eigentümergebühr für Ausgabe-Ziehen. */
function outputDrawPaymentsFor(
  field: FieldState,
  mover: PlayerId,
): { payments: Payment[]; meterAfter: number } {
  const draw = meterOutputDrawCost(fieldMeter(field))
  const payments: Payment[] = []
  if (draw.cost > 0) payments.push({ to: 'bank', amount: draw.cost })
  const fee = usageFee(field, mover)
  if (fee) payments.push(fee)
  return { payments, meterAfter: draw.meterAfter }
}

/** Nur der Eigentümer darf seinen Schuppen nutzen. */
function infraOwnerRejected(
  field: FieldState,
  mover: PlayerId,
): string | null {
  if (!hasOwnership(field.kind)) return null
  if (field.owner === mover) return null
  return `${field.label} gehört ${field.owner === 'state' ? 'dem Staat' : 'einem anderen Spieler'}`
}

/**
 * Regen: nur die eigene Sorte (Wasser) ablegen.
 * Getreidefeld: weiterhin jede Sorte (Rangfolge).
 * Saatstand: kein Parken — Obst geht über den Eingang (feed).
 */
function sourceParkRejected(
  field: FieldState,
  packet: Card[],
): string | null {
  if (field.kind !== 'source' || !field.suit) return null
  if (isSeedBed(field)) {
    return `${field.label}: Obst nur am Eingang ablegen; Ausgabe nicht zum Parken`
  }
  if (field.suit !== 'energy') return null
  if (packet.every((c) => c.suit === field.suit)) return null
  return `${field.label} nimmt nur ${suitName(field.suit)} ${suitSymbol(field.suit)}`
}

function mergePayments(payments: (Payment | null)[]): Payment[] {
  const agg = new Map<Payment['to'], number>()
  for (const p of payments) {
    if (!p || p.amount <= 0) continue
    agg.set(p.to, (agg.get(p.to) ?? 0) + p.amount)
  }
  return [...agg.entries()].map(([to, amount]) => ({ to, amount }))
}

function fitsOnCards(card: Card, stack: Card[]): boolean {
  const top = topOfCards(stack)
  return !top || canStackOn(card.rank, top.rank)
}

function fitsOnStack(
  card: Card,
  field: FieldState,
  toStackIndex = 0,
): boolean {
  if (field.kind === 'victory') {
    const cols = victoryColumns(field)
    const stack = cols[Math.max(0, toStackIndex)] ?? cols[0]!
    if (stack.length >= VICTORY_COLUMN_LENGTH) return false
    // Leere Spalte: beliebiger Start; sonst absteigend.
    if (stack.length === 0) return true
    return fitsOnCards(card, stack)
  }
  if (field.kind === 'market') {
    const inputs = marketInputs(field)
    const stack = inputs[Math.max(0, toStackIndex)] ?? inputs[0]!
    return fitsOnCards(card, stack)
  }
  if (hasOutputStack(field)) {
    // Ziel ist immer der Rezept-/Markt-Eingang, nie eine Ausgabe.
    return fitsOnCards(card, field.stack)
  }
  return fitsOnCards(card, field.stack)
}

export type MoveStackOpts = {
  stackIndex?: number
  toStackIndex?: number
}

export type MoveKind =
  /** Rohstoff von einer Quelle auf eine Fabrik. */
  | 'supply'
  /** Rohstoff von Fabrik/Lager zu Fabrik (oder Rohstoff vom Lager auf eine Fabrik). */
  | 'shift'
  /** Fertigprodukt auf einen Marktstand. */
  | 'deliver'
  /** Zutat auf den Küchen-Eingang (Bedarf ↑, Einkommen wie Markt). */
  | 'feed'
  /** Beliebige Karte auf einen Schuppen (Umsortieren). */
  | 'park'
  /** Siegpunkte auf eine VP-Spalte (absteigend, bis 2). */
  | 'claim'

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
  /** Einkommen laut Bedarfsmesser (Markt-Lieferung oder Küchen-Eingang). */
  income: number
  /** Bedarfsmesser des Ziels nach der Aktion. */
  meterAfter?: number
  /** Farbe/Bezug des Ziel-Messers. */
  meterSuit?: Suit
  /** Küchen-Ausgabe: Bedarfsmesser der Quelle nach dem Ziehen. */
  fromMeterAfter?: number
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
  lane?: StackLane,
  opts: MoveStackOpts = {},
): MoveCheck {
  if (state.ended) return fail('Partie beendet')
  const from = state.fields[fromId]
  const to = state.fields[toId]
  if (!from || !to) return fail('Unbekanntes Feld')
  const fromLane =
    lane ??
    (state.selection?.fieldId === fromId ? state.selection.lane : undefined)
  const fromStackIndex =
    opts.stackIndex ??
    (state.selection?.fieldId === fromId
      ? (state.selection.stackIndex ?? 0)
      : 0)
  const toStackIndex = opts.toStackIndex ?? 0
  // Umsortieren innerhalb des Siegpunktefeldes (andere Spalte).
  if (fromId === toId) {
    if (from.kind !== 'victory' || fromStackIndex === toStackIndex) {
      return fail('Gleiches Feld')
    }
  }
  const resolved =
    from.kind === 'victory' ? 'main' : resolveLane(from, fromLane)
  const fromStack = movableStack(from, fromLane, fromStackIndex)
  const max = maxMovableRun(from, fromLane, fromStackIndex)
  if (max < 1) return fail('Keine Karte zum Bewegen')
  const n = Math.floor(count)
  if (n < 1 || n > max) {
    return fail('Ungültige Teilstapelhöhe', { count: n })
  }
  const packet = selectedPacket(fromStack, n)
  // Erste Karte, die auf dem Ziel landet (= unterste der Auswahl).
  const lead = packet[0]!

  const mover = currentPlayer(state)
  let kind: MoveKind
  let payments: Payment[]
  let income = 0
  let meterAfter: number | undefined
  let meterSuit: Suit | undefined
  let fromMeterAfter: number | undefined

  if (!fitsOnStack(lead, to, toStackIndex)) {
    return fail('Karte muss genau einen Rang niedriger sein', { count: n })
  }

  const allRaw = packet.every((c) => isRawSuit(c.suit))
  const allProduct = packet.every((c) => isProductSuit(c.suit))
  const allPoints = packet.every((c) => isPointsSuit(c.suit))

  // Ausgabe: Bedarfspreis → Bank, Eigentümergebühr → Inhaber; Messer −1.
  // Vom Eingang zurücknehmen ist kostenlos und ändert den Bedarf nicht.
  let outputDrawPayments: Payment[] = []
  if (resolved === 'output') {
    const draw = outputDrawPaymentsFor(from, mover.id)
    fromMeterAfter = draw.meterAfter
    outputDrawPayments = draw.payments
  }

  const fromInfraBlock = infraOwnerRejected(from, mover.id)
  if (fromInfraBlock) return fail(fromInfraBlock, { count: n })

  // Entnahme von Quellen/Schuppen ohne Gebühr; Ausgabe trägt Bedarfspreis + Gebühr.
  const takeFees: (Payment | null)[] = [...outputDrawPayments]

  if (to.kind === 'victory') {
    const toInfraBlock = infraOwnerRejected(to, mover.id)
    if (toInfraBlock) return fail(toInfraBlock, { count: n })
    if (!allPoints) {
      return fail('Nur Siegpunkte auf das Siegpunktefeld', { count: n })
    }
    // Gesamter Teilstapel muss auf die Spalte passen (absteigend).
    const col = victoryColumns(to)[Math.max(0, toStackIndex)] ?? []
    if (col.length + n > VICTORY_COLUMN_LENGTH) {
      return fail('Spalte ist voll (max. 6 Karten)', { count: n })
    }
    kind = 'claim'
    payments = mergePayments(takeFees)
  } else if (to.kind === 'storage') {
    const toInfraBlock = infraOwnerRejected(to, mover.id)
    if (toInfraBlock) return fail(toInfraBlock, { count: n })
    if (to.suit && !packet.every((c) => c.suit === to.suit)) {
      return fail(
        `${to.label} nimmt nur ${suitName(to.suit)} ${suitSymbol(to.suit)}`,
        { count: n },
      )
    }
    kind = 'park'
    payments = mergePayments(takeFees)
  } else if (to.kind === 'factory' || isSeedBed(to)) {
    // Eingang: nur Rezeptkarten; Eigentümergebühr jetzt, Bedarf/Einkommen am Zugende.
    const recipe = to.recipe ?? (isSeedBed(to) ? SEED_BED_RECIPE : {})
    if (!packet.every((c) => canFeedFactory(c, to))) {
      return fail(
        `Passt nicht zur ${to.label} (Rezept: ${recipeLabel(recipe)})`,
        { count: n },
      )
    }
    kind = 'feed'
    payments = mergePayments([...takeFees, usageFee(to, mover.id)])
  } else if (to.kind === 'source') {
    const parkFail = sourceParkRejected(to, packet)
    if (parkFail) return fail(parkFail, { count: n })
    if (packet.some((c) => isPointsSuit(c.suit))) {
      return fail('Siegpunkte gehören nicht auf Felder', { count: n })
    }
    kind = 'park'
    payments = mergePayments([...takeFees, usageFee(to, mover.id)])
  } else if (to.kind === 'market') {
    if (!to.suit) return fail('Markt ohne Farbe', { count: n })
    if (packet.some((c) => isPointsSuit(c.suit))) {
      return fail('Siegpunkte gehören nicht auf den Markteingang', { count: n })
    }
    if (!packet.every((c) => c.suit === to.suit)) {
      return fail(`Nur ${suitName(to.suit)}-Karten`, { count: n })
    }
    // Ablegen: Eigentümergebühr jetzt; Einkommen/Bedarf am Zugende.
    kind = 'deliver'
    payments = mergePayments([...takeFees, usageFee(to, mover.id)])
  } else if (allPoints) {
    return fail(
      'Siegpunkte gehören auf das Siegpunktefeld oder einen Schuppen',
      { count: n },
    )
  } else if (allRaw) {
    return fail(
      'Zutaten gehören in eine Küche, ein Beet, einen Schuppen oder an den passenden Stand',
      { count: n },
    )
  } else if (allProduct) {
    return fail(
      'Fertigprodukte gehören auf einen Marktstand, Beet, Schuppen oder in die Weiterverarbeitung',
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
    fromMeterAfter,
  }
  // Einkommen zuerst (Bargeld aus der Bank), Gebühren danach.
  const earns = kind === 'deliver' || kind === 'feed'
  const cashAfterIncome = earns
    ? mover.money + Math.min(income, state.bank)
    : mover.money
  if (cashAfterIncome < cost) {
    const short = cost - cashAfterIncome
    const detail =
      earns && income > 0
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
  lane?: StackLane,
  opts: MoveStackOpts = {},
): FieldId[] {
  if (!movableCard(state, fromId, lane, opts.stackIndex ?? 0)) return []
  return Object.keys(state.fields).filter(
    (toId) => checkMove(state, fromId, toId, count, lane, opts).ok,
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
 * Feld auswählen bzw. Teilstapelhöhe erhöhen (erneuter Klick).
 * Bei Küche/Saatstand: `lane` wählt Eingang oder Ausgabe.
 * `stackIndex` wählt Ausgabe- bzw. Markteingangs-Stapel.
 * Zykliert 1 → … → maxRun → 1.
 */
export function selectField(
  state: GameState,
  fieldId: FieldId,
  lane?: StackLane,
  stackIndex = 0,
): GameState {
  const next = cloneState(state)
  if (next.ended) return next
  const idx = Math.max(0, Math.floor(stackIndex))
  if (!movableCard(next, fieldId, lane, idx)) {
    clearSelection(next)
    return next
  }
  const field = next.fields[fieldId]!
  if (field.kind === 'victory') {
    if (!movableCard(next, fieldId, undefined, idx)) {
      clearSelection(next)
      return next
    }
    const max = maxMovableRun(field, undefined, idx)
    if (max < 1) {
      clearSelection(next)
      return next
    }
    const prev = next.selection
    const same =
      prev?.fieldId === fieldId &&
      (prev.stackIndex ?? 0) === idx &&
      !prev.lane
    const stackOpt = idx > 0 ? { stackIndex: idx } : {}
    if (same && prev) {
      next.selection = {
        fieldId,
        count: prev.count >= max ? 1 : prev.count + 1,
        ...stackOpt,
      }
    } else {
      next.selection = { fieldId, count: 1, ...stackOpt }
    }
    next.actionError = null
    return next
  }
  const resolved = resolveLane(field, lane)
  const selLane: StackLane | undefined =
    resolved === 'main' ? undefined : resolved
  if (resolved === 'input') {
    const inStack =
      field.kind === 'market'
        ? movableStack(field, 'input', idx)
        : field.stack
    if (inStack.length === 0) {
      clearSelection(next)
      return next
    }
  }
  if (resolved === 'output' && !factoryProduct(field, idx)) {
    clearSelection(next)
    return next
  }
  const max = maxMovableRun(field, selLane, idx)
  if (max < 1) {
    clearSelection(next)
    return next
  }
  const prev = next.selection
  const same =
    prev?.fieldId === fieldId &&
    (prev.lane ?? 'output') === (selLane ?? 'output') &&
    (prev.stackIndex ?? 0) === idx
  const stackOpt = idx > 0 ? { stackIndex: idx } : {}
  if (same && prev) {
    next.selection = {
      fieldId,
      count: prev.count >= max ? 1 : prev.count + 1,
      ...(selLane ? { lane: selLane } : {}),
      ...stackOpt,
    }
  } else {
    next.selection = {
      fieldId,
      count: 1,
      ...(selLane ? { lane: selLane } : {}),
      ...stackOpt,
    }
  }
  next.actionError = null
  return next
}

/**
 * Zugende: Unter-/Überversorgung prüfen (kein automatisches Markt-−1 mehr).
 */
function applyEndOfTurnDemand(state: GameState): void {
  if (state.ended) return
  resolveDemandExtremes(state)
}

/** Felder mit Bedarfsmesser (Markt, Küche, Saatstand). */
function demandFields(state: GameState): FieldState[] {
  return Object.values(state.fields).filter(
    (f) => f.kind === 'market' || hasOutputStack(f),
  )
}

/**
 * Unter −8: Feld entfernen.
 * Über +5: Extra-Ausgabestapel bzw. Markteingang, Bedarf → 0.
 */
function resolveDemandExtremes(state: GameState): void {
  const snapshot = demandFields(state)
  for (const field of snapshot) {
    if (!state.fields[field.id]) continue
    const meter = fieldMeter(field)
    if (meter < TENSION_MIN) {
      removeDemandField(state, field)
      continue
    }
    if (meter > OVERSUPPLY_COLLAPSE) {
      expandOversupply(state, field)
    }
  }

  checkEndConditions(state)
}

/** Überversorgung: neuen Stapel/Eingang, Bedarf auf 0. */
function expandOversupply(state: GameState, field: FieldState): void {
  const before = meterLabel(fieldMeter(field))
  if (field.kind === 'market') {
    addMarketInput(field)
    setFieldMeter(field, 0)
    state.planetLimitSeq += 1
    state.planetLimitFlash = `${field.label}: neuer Eingang`
    state.planetLimitId = field.id
    state.stats.marketsSpawned += 1
    log(
      state,
      `${field.label}: Bedarf ${before} — neuer Eingang, Bedarf 0.`,
      'tension',
    )
    return
  }
  if (hasOutputStack(field)) {
    addFactoryOutputStack(state, field)
    setFieldMeter(field, 0)
    state.planetLimitSeq += 1
    state.planetLimitFlash = `${field.label}: neuer Ausgabestapel`
    state.planetLimitId = field.id
    state.stats.marketsSpawned += 1
    log(
      state,
      `${field.label}: Bedarf ${before} — neuer Ausgabestapel, Bedarf 0.`,
      'tension',
    )
  }
}

/** Feld mit Bedarfsmesser vom Brett nehmen (Karten auf Ablage). */
function removeDemandField(state: GameState, field: FieldState): void {
  const label = meterLabel(fieldMeter(field))
  state.planetLimitSeq += 1
  state.planetLimitFlash = `${field.label}: ${label}`
  state.planetLimitId = field.id
  discard(state, field.stack)
  field.stack = []
  if (field.kind === 'market') {
    for (const input of marketInputs(field)) discard(state, input)
    field.inputs = []
  }
  if (hasOutputStack(field)) {
    for (const out of factoryOutputs(field)) discard(state, out)
    field.outputs = []
    field.outputsRevealed = []
  }
  delete state.fields[field.id]
  if (state.selection?.fieldId === field.id) clearSelection(state)
  state.stats.marketCollapses += 1
  log(
    state,
    `${field.label}: Bedarf ${label} — Feld entfernt.`,
    'tension',
  )
}

/**
 * Zusätzliche Quelle spawnen (auch wenn schon eine gleicher Farbe existiert).
 */
function spawnAdditionalSource(state: GameState, suit: RawSuit): FieldState {
  state.marketSpawnSeq += 1
  const n =
    Object.values(state.fields).filter(
      (f) => f.kind === 'source' && f.suit === suit,
    ).length + 1
  const id = `quelle-${suit}-${state.marketSpawnSeq}`
  const label = sourceTitle(suit, n)
  const stack: Card[] = []
  let outputs: Card[][] | undefined
  let outputsRevealed: number[] | undefined
  let demand: number | undefined
  let recipe: Recipe | undefined
  if (suit === 'hearts') {
    demand = BOUGHT_FIELD_START_DEMAND
    recipe = SEED_BED_RECIPE
    const out: Card[] = []
    for (let i = 0; i < FACTORY_OUTPUT_SIZE; i++) {
      const card = drawCard(state, suit)
      if (!card) break
      out.push(card)
    }
    outputs = [out]
    outputsRevealed = [out.length > 0 ? 1 : 0]
  } else {
    for (let i = 0; i < START_CARDS_PER_SPAWNED_SOURCE; i++) {
      const card = drawCard(state, suit)
      if (card) stack.push(card)
    }
  }
  const spawned: FieldState = {
    id,
    kind: 'source',
    suit,
    label,
    row: ROW.source,
    stack,
    fee: 0,
    ...(outputs
      ? { outputs, outputsRevealed, demand, recipe }
      : {}),
  }
  const anchor =
    [...Object.keys(state.fields)]
      .reverse()
      .find((fid) => state.fields[fid]!.kind === 'source') ??
    Object.keys(state.fields)[0]!
  insertFieldAfter(state, anchor, spawned)
  return spawned
}

/** @deprecated Exp-10-Angebot entfällt. */
export function resolveLagerOffer(
  state: GameState,
  _winner: PlayerId | null,
  _price: number,
  _fee?: number,
): GameState {
  const next = cloneState(state)
  return failAction(next, 'Lager-Angebot entfällt')
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

function nextMarketLabel(state: GameState, suit: Suit): string {
  const n =
    Object.values(state.fields).filter(
      (f) => f.kind === 'market' && f.suit === suit,
    ).length + 1
  return marketTitle(suit, n)
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
    inputs: [[]],
    outputs: [[]],
    outputsRevealed: [0],
    fee: 0,
    demand: 0,
  }
  refillFactoryOutput(state, spawned, 0)
  if ((spawned.outputsRevealed?.[0] ?? 0) === 0 && (spawned.outputs?.[0]?.length ?? 0) > 0) {
    spawned.outputsRevealed = [1]
  }
  insertFieldAfter(state, afterId, spawned)
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
    label: factoryTitle(suit, letter),
    recipe,
    row: ROW.factory,
    stack: [],
    outputs: [[]],
    outputsRevealed: [0],
    // Gekaufte Küchen starten neutral (wie Szenario-Felder).
    demand: 0,
    fee: 0,
  }
  refillFactoryOutput(state, spawned, 0)
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

/**
 * Quelle (Regen / Getreidefeld) mit mehr als 8 Karten: Feld vom Brett nehmen.
 * Nur am Zugende (nach dem Nachziehen), nicht sofort beim Ablegen.
 */

function collapseSourceIfOverloaded(
  state: GameState,
  source: FieldState,
): void {
  if (source.kind !== 'source') return
  if (source.stack.length <= SOURCE_STACK_LIMIT) return

  const n = source.stack.length
  const id = source.id
  const label = source.label
  state.planetLimitSeq += 1
  state.planetLimitFlash = `${label}: ${n} Karten`
  state.planetLimitId = id
  discard(state, source.stack)
  source.stack = []
  if (hasOutputStack(source)) {
    for (const out of factoryOutputs(source)) discard(state, out)
    source.outputs = []
    source.outputsRevealed = []
  }
  delete state.fields[id]
  if (state.selection?.fieldId === id) clearSelection(state)
  state.stats.sourceCollapses += 1
  log(
    state,
    `${label}: ${n} Karten — Feld kollabiert und wird entfernt.`,
    'tension',
  )
}

function marketCount(state: GameState): number {
  return Object.values(state.fields).filter((f) => f.kind === 'market').length
}

/** Märkte mit Bedarf &gt; 0 („Versorgung“ über 0). */
export function suppliedMarketCount(state: GameState): number {
  return Object.values(state.fields).filter(
    (f) => f.kind === 'market' && fieldMeter(f) > 0,
  ).length
}

/** Anzahl voller Siegpunkte-Spalten (absteigend, endet auf 2). */
export function completedVictoryColumns(
  state: GameState,
  playerId: PlayerId,
): number {
  const field = state.fields[`sieg-${playerId}`]
  if (!field || field.kind !== 'victory') return 0
  return victoryColumns(field).filter(isVictoryColumnComplete).length
}

/** @deprecated Alias — bitte completedVictoryColumns nutzen. */
export const completedVictoryRows = completedVictoryColumns

/** Siegpunkte (Karten) auf dem Feld eines Spielers. */
export function victoryPointCount(
  state: GameState,
  playerId: PlayerId,
): number {
  const field = state.fields[`sieg-${playerId}`]
  if (!field || field.kind !== 'victory') return 0
  return victoryColumns(field).reduce((s, col) => s + col.length, 0)
}

/**
 * Niederlage: keine Märkte.
 * Sieg: ein Spieler hat alle 3 Siegpunkte-Spalten voll (je 6 Karten, 7→2).
 */
function checkEndConditions(
  state: GameState,
  _opts: { checkWin?: boolean } = {},
): void {
  if (state.ended) return
  if (marketCount(state) === 0) {
    endGame(state, 'Kein Marktstand mehr — Partie verloren.')
    return
  }
  for (const player of state.players) {
    const field = state.fields[`sieg-${player.id}`]
    if (field && isVictoryFieldComplete(field)) {
      endGame(
        state,
        `${player.name} hat alle ${VICTORY_COLUMN_COUNT} Siegpunkte-Spalten voll (7→2).`,
      )
      return
    }
  }
}

function endGame(state: GameState, reason: string): void {
  if (state.ended) return
  state.ended = true
  clearSelection(state)

  state.winnerText = reason.includes('verloren')
    ? reason
    : reason.startsWith('Sieg:')
      ? reason
      : `Sieg: ${reason}`
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
  lane?: StackLane,
  opts: MoveStackOpts = {},
): GameState {
  const next = cloneState(state)
  next.actionError = null
  if (next.ended) return next

  const fromLane =
    lane ??
    (next.selection?.fieldId === fromId ? next.selection.lane : undefined)
  const fromStackIndex =
    opts.stackIndex ??
    (next.selection?.fieldId === fromId
      ? (next.selection.stackIndex ?? 0)
      : 0)
  const toStackIndex = opts.toStackIndex ?? 0
  const check = checkMove(next, fromId, toId, count, fromLane, {
    stackIndex: fromStackIndex,
    toStackIndex,
  })
  if (!check.ok) return failAction(next, check.reason ?? 'Ungültige Bewegung')

  const player = currentPlayer(next)
  const from = next.fields[fromId]!
  const to = next.fields[toId]!
  const n = check.count
  const resolved =
    from.kind === 'victory' ? 'main' : resolveLane(from, fromLane)
  const fromStack = movableStack(from, fromLane, fromStackIndex)
  const revealedBefore =
    resolved === 'output'
      ? outputRevealedCount(from, fromStackIndex)
      : 0
  const packet = fromStack.splice(fromStack.length - n, n)
  if (resolved === 'output') {
    if (check.fromMeterAfter != null) setFieldMeter(from, check.fromMeterAfter)
    if ((factoryOutputs(from)[fromStackIndex]?.length ?? 0) === 0) {
      refillFactoryOutput(next, from, fromStackIndex)
    }
    const outsRev = from.outputsRevealed ?? []
    while (outsRev.length <= fromStackIndex) outsRev.push(0)
    outsRev[fromStackIndex] = Math.max(1, revealedBefore - n)
    from.outputsRevealed = outsRev
  }

  const destStack =
    to.kind === 'victory'
      ? victoryColumns(to)[Math.max(0, toStackIndex)] ??
        victoryColumns(to)[0]!
      : to.kind === 'market'
        ? marketInputs(to)[Math.max(0, toStackIndex)] ?? marketInputs(to)[0]!
        : to.stack

  const costNote = check.cost > 0 ? ` (−${check.cost}¤)` : ''
  const packetNote =
    n > 1 ? ` (${n} Karten: ${packet.map(describeCard).join(' ')})` : ''
  const fromLabel =
    from.kind === 'victory'
      ? `${from.label} (Spalte ${(fromStackIndex ?? 0) + 1})`
      : resolved === 'input'
        ? `${from.label} (Eingang)`
        : resolved === 'output' && from.kind === 'market'
          ? `${from.label} (Ausgabe)`
          : from.label
  const toLabel =
    to.kind === 'victory'
      ? `${to.label} (Spalte ${toStackIndex + 1})`
      : to.label

  if (check.kind === 'deliver' || check.kind === 'feed') {
    for (const card of packet) destStack.push(card)
    pay(next, check.payments)
    const verb = check.kind === 'feed' ? 'legt' : 'liefert'
    log(
      next,
      `${player.name} ${verb}${packetNote || ` ${describeCard(packet[0]!)}`} von ${fromLabel} auf ${toLabel}${costNote} (Abrechnung am Zugende).`,
      check.cost > 0 ? 'money' : 'info',
    )
  } else if (check.kind === 'claim') {
    pay(next, check.payments)
    for (const card of packet) destStack.push(card)
    const fromMeterNote =
      resolved === 'output' && check.fromMeterAfter != null
        ? ` — Bedarf ${meterLabel(check.fromMeterAfter)}`
        : ''
    log(
      next,
      `${player.name} legt${packetNote || ` ${describeCard(packet[0]!)}`} von ${fromLabel} auf ${toLabel}${costNote}${fromMeterNote}.`,
      check.cost > 0 ? 'money' : 'production',
    )
  } else {
    pay(next, check.payments)
    for (const card of packet) destStack.push(card)
    const fromMeterNote =
      resolved === 'output' && check.fromMeterAfter != null
        ? ` — Bedarf ${meterLabel(check.fromMeterAfter)}`
        : ''
    log(
      next,
      `${player.name} legt${packetNote || ` ${describeCard(packet[0]!)}`} von ${fromLabel} auf ${toLabel}${costNote}${fromMeterNote}.`,
      resolved === 'output' && check.cost > 0 ? 'money' : 'info',
    )
  }

  clearSelection(next)
  checkEndConditions(next)
  return next
}

/**
 * Gebühr eines eigenen Feldes/Küche/Standes ändern (kostenlos, ≥ 0, beliebig oft).
 * Schuppen haben keine Nutzungsgebühr.
 */
export function setFee(
  state: GameState,
  fieldId: FieldId,
  fee: number,
): GameState {
  const next = cloneState(state)
  next.actionError = null
  if (next.ended) return next
  const field = next.fields[fieldId]
  if (!field) return failAction(next, 'Unbekanntes Feld')
  if (field.kind === 'storage' || field.kind === 'victory') {
    return failAction(next, 'Dieser Stapel hat keine Gebühr')
  }
  const player = currentPlayer(next)
  if (field.owner !== player.id) {
    return failAction(next, 'Nur der Eigentümer kann die Gebühr setzen')
  }
  const nextFee = Math.max(0, Math.floor(fee))
  if (field.fee === nextFee) return next
  field.fee = nextFee
  log(
    next,
    `${player.name} setzt Gebühr von ${field.label} auf ${nextFee}¤.`,
    'money',
  )
  return next
}

/** Käufliche Gemeinschafts-/Infrastrukturfelder (Plus-Button). */
export type BuyableInfra =
  | 'schuppen'
  | 'getreidefeld'
  | 'mehlmuehle'
  | 'konfituerenkueche'
  | 'mehlstand'
  | 'konfituerenstand'

export const BUYABLE_INFRA: BuyableInfra[] = [
  'getreidefeld',
  'mehlmuehle',
  'konfituerenkueche',
  'mehlstand',
  'konfituerenstand',
  'schuppen',
]

export function buyableInfraLabel(item: BuyableInfra): string {
  switch (item) {
    case 'schuppen':
      return 'Schuppen'
    case 'getreidefeld':
      return 'Getreidefeld'
    case 'mehlmuehle':
      return 'Mehlmühle'
    case 'konfituerenkueche':
      return 'Konfitürenküche'
    case 'mehlstand':
      return 'Mehlstand'
    case 'konfituerenstand':
      return 'Konfitürenstand'
  }
}

/** Kurzname für den Plus-Button. */
export function buyableInfraShort(item: BuyableInfra): string {
  switch (item) {
    case 'schuppen':
      return 'Schuppen'
    case 'getreidefeld':
      return 'Getreide'
    case 'mehlmuehle':
      return 'Mühle'
    case 'konfituerenkueche':
      return 'Küche'
    case 'mehlstand':
      return 'Mehlstand'
    case 'konfituerenstand':
      return 'Konfi-Stand'
  }
}

/** Persönliche Allgemein-Schuppen eines Spielers (ohne Spezialsorte). */
export function personalBeetCount(
  state: GameState,
  playerId: PlayerId,
): number {
  return Object.values(state.fields).filter(
    (f) => f.kind === 'storage' && f.owner === playerId && !f.suit,
  ).length
}

function countBuyableInfra(
  state: GameState,
  item: BuyableInfra,
  playerId?: PlayerId,
): number {
  const fields = Object.values(state.fields)
  switch (item) {
    case 'schuppen':
      return playerId
        ? personalBeetCount(state, playerId)
        : fields.filter((f) => f.kind === 'storage' && !f.suit).length
    case 'getreidefeld':
      return fields.filter((f) => f.kind === 'source' && f.suit === 'spades')
        .length
    case 'mehlmuehle':
      return fields.filter((f) => f.kind === 'factory' && f.suit === 'diamonds')
        .length
    case 'konfituerenkueche':
      return fields.filter((f) => f.kind === 'factory' && f.suit === 'steel')
        .length
    case 'mehlstand':
      return fields.filter((f) => f.kind === 'market' && f.suit === 'diamonds')
        .length
    case 'konfituerenstand':
      return fields.filter((f) => f.kind === 'market' && f.suit === 'steel')
        .length
  }
}

/**
 * Preis: 20¤, 40¤, 80¤, … (jeweils verdoppelt).
 * Schuppen: nur nach bereits *gekauften* Extras pro Spieler
 * (Start-Schuppen zählen nicht — 1. Kauf immer 20¤).
 * Sonst: nach globaler Anzahl des Typs.
 */
export function nextBuyInfraPrice(
  state: GameState,
  item: BuyableInfra,
  playerId: PlayerId,
): number {
  if (item === 'schuppen') {
    const owned = personalBeetCount(state, playerId)
    const starts =
      state.beetsPerPlayer ??
      getScenario(state.scenarioId).beetsPerPlayer
    const bought = Math.max(0, owned - starts)
    return 20 * 2 ** bought
  }
  const k = countBuyableInfra(state, item, playerId)
  if (k < 1) return 20
  return 20 * 2 ** (k - 1)
}

/** @deprecated Alias — nutze nextBuyInfraPrice(..., 'schuppen'). */
export function nextBeetPrice(state: GameState, playerId: PlayerId): number {
  return nextBuyInfraPrice(state, 'schuppen', playerId)
}

function nextPersonalBeetIndex(state: GameState, playerId: PlayerId): number {
  let max = 0
  const re = new RegExp(`^lager-${playerId}-(\\d+)$`)
  for (const f of Object.values(state.fields)) {
    const m = re.exec(f.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

function spawnBoughtSchuppen(
  state: GameState,
  playerId: PlayerId,
): FieldState | null {
  const index = nextPersonalBeetIndex(state, playerId)
  const multi = state.players.length > 1
  const id = `lager-${playerId}-${index}`
  if (state.fields[id]) return null
  const spawned: FieldState = {
    id,
    kind: 'storage',
    label: personalBeetLabel(playerId, index, multi),
    row: ROW.storage,
    owner: playerId,
    fee: 0,
    stack: [],
  }
  const anchor =
    [...Object.keys(state.fields)]
      .reverse()
      .find((fid) => {
        const f = state.fields[fid]!
        return f.kind === 'storage' && f.owner === playerId && !f.suit
      }) ??
    [...Object.keys(state.fields)]
      .reverse()
      .find((fid) => state.fields[fid]!.kind === 'storage') ??
    Object.keys(state.fields)[0]!
  insertFieldAfter(state, anchor, spawned)
  return spawned
}

/** Feld über Plus-Button kaufen (Schuppen persönlich, Rest gemeinschaftlich). */
export function executeBuyInfra(
  state: GameState,
  item: BuyableInfra,
): GameState {
  const next = cloneState(state)
  next.actionError = null
  if (next.ended) return next

  const player = currentPlayer(next)
  const price = nextBuyInfraPrice(next, item, player.id)
  if (price < 20) {
    return failAction(next, `Kein ${buyableInfraLabel(item)}-Kauf möglich`)
  }
  if (player.money < price) {
    return failAction(next, `Nicht genug Geld (${price}¤)`)
  }

  let spawned: FieldState | null = null
  if (item === 'schuppen') {
    spawned = spawnBoughtSchuppen(next, player.id)
  } else if (item === 'getreidefeld') {
    spawned = spawnAdditionalSource(next, 'spades')
  } else if (item === 'mehlmuehle') {
    spawned = spawnFactoryField(next, 'diamonds')
  } else if (item === 'konfituerenkueche') {
    spawned = spawnFactoryField(next, 'steel')
  } else if (item === 'mehlstand' || item === 'konfituerenstand') {
    const suit = item === 'mehlstand' ? 'diamonds' : 'steel'
    const anchor =
      [...Object.keys(next.fields)]
        .reverse()
        .find((fid) => next.fields[fid]!.kind === 'market') ??
      Object.keys(next.fields)[0]!
    spawned = spawnMarketField(next, suit, anchor)
  }

  if (!spawned) {
    return failAction(next, `${buyableInfraLabel(item)} konnte nicht angelegt werden`)
  }

  if (item !== 'schuppen') {
    spawned.owner = player.id
    spawned.fee = 0
  }

  player.money -= price
  next.bank += price
  next.stats.feesPaidToBank += price

  const demandNote =
    spawned.demand != null ? `, Bedarf ${spawned.demand}` : ''
  log(
    next,
    `${player.name} kauft ${spawned.label} für ${price}¤ (Eigentum${demandNote}).`,
    'money',
  )
  checkEndConditions(next)
  return next
}

/** Neuen persönlichen Schuppen kaufen. */
export function executeBuyBeet(state: GameState): GameState {
  return executeBuyInfra(state, 'schuppen')
}

/** @deprecated Kopien entfallen — Überversorgung erzeugt Extra-Stapel. */
export function canBuyFieldCopy(
  _state: GameState,
  _fieldId: FieldId,
): boolean {
  return false
}

/** Preis für eine Kopie dieses Feldes (20¤, 40¤, … nach Typ-Anzahl). */
export function nextFieldCopyPrice(state: GameState, fieldId: FieldId): number {
  const field = state.fields[fieldId]
  if (!field) return 20
  const k = countSimilarDemandFields(state, field)
  if (k < 1) return 20
  return 20 * 2 ** (k - 1)
}

function countSimilarDemandFields(state: GameState, field: FieldState): number {
  return Object.values(state.fields).filter((f) => {
    if (f.kind !== field.kind) return false
    if (field.kind === 'market' || field.kind === 'factory') {
      return f.suit === field.suit
    }
    if (isSeedBed(field)) return isSeedBed(f)
    return false
  }).length
}

/** @deprecated Feldkopien entfallen. */
export function executeBuyFieldCopy(
  state: GameState,
  _fieldId: FieldId,
): GameState {
  const next = cloneState(state)
  next.actionError = null
  return failAction(
    next,
    'Feldkopien entfallen — Überversorgung erzeugt Extra-Stapel',
  )
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

/** Infrastruktur ist persönlich — keine Auktionen. */
export function auctionInfo(_state: GameState, _fieldId: FieldId): AuctionInfo {
  return {
    ok: false,
    reason: 'Infrastruktur ist persönlich und nicht auktionierbar',
    bidders: [],
  }
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
 * Markt-Lieferungen abrechnen (je Waren-Karte) und Eingänge leeren.
 * Siegpunkte auf Eingängen bleiben liegen und zählen nicht.
 * Einkommen geht an den aktiven Spieler.
 */
function settleAndClearMarkets(state: GameState, player: PlayerState): void {
  const notes: string[] = []
  for (const field of Object.values(state.fields)) {
    if (field.kind !== 'market') continue
    const inputs = marketInputs(field)
    let totalGoods = 0
    for (const input of inputs) totalGoods += withoutPoints(input).length
    const anyPoints = inputs.some((input) =>
      input.some((c) => isPointsSuit(c.suit)),
    )
    if (totalGoods === 0) {
      if (anyPoints) {
        notes.push(`${field.label}: nur Siegpunkte — bleiben liegen`)
      }
      continue
    }

    let meter = fieldMeter(field)
    let income = 0
    for (const input of inputs) {
      for (const c of withoutPoints(input)) {
        void c
        const payout = meterDeliveryPayout(meter)
        income += payout.income
        meter = payout.meterAfter
      }
    }
    state.stats.productsDelivered += totalGoods
    setFieldMeter(field, meter)
    const paid = payFromBank(state, income)
    for (const input of inputs) {
      const goods = withoutPoints(input)
      const kept = input.filter((c) => isPointsSuit(c.suit))
      discard(state, goods)
      input.length = 0
      for (const c of kept) input.push(c)
    }
    const claim = income - paid
    notes.push(
      `${field.label} ${totalGoods}× → +${paid}¤${claim > 0 ? ` (+${claim} Forderung)` : ''} ${suitSymbol(field.suit!)}${meterLabel(meter)}`,
    )
  }
  if (notes.length) {
    log(
      state,
      `${player.name}: Markt-Abrechnung — ${notes.join('; ')}.`,
      'money',
    )
  }
}

/**
 * Küchen-/Saatstand-Eingänge abrechnen (je Rezept-Erfüllung) und leeren.
 * Siegpunkte bleiben liegen und zählen nicht zum Rezept.
 * Beet: ohne mind. 1 Wasser + 1 Saat weder Erfüllung noch Abräumen.
 */
function settleAndClearInputs(state: GameState, player: PlayerState): void {
  const notes: string[] = []
  for (const field of Object.values(state.fields)) {
    if (!(field.kind === 'factory' || isSeedBed(field))) continue
    if (field.stack.length === 0) continue
    const goods = withoutPoints(field.stack)
    const keptPoints = field.stack.filter((c) => isPointsSuit(c.suit))
    if (goods.length === 0) {
      notes.push(`${field.label}: nur Siegpunkte — bleiben liegen`)
      continue
    }
    const recipe = field.recipe ?? (isSeedBed(field) ? SEED_BED_RECIPE : {})
    const isBeetFactory = field.kind === 'factory' && field.suit === 'clubs'
    // Beet: bei mind. 1 Wasser + 1 Saat zählt jede Waren-Karte; sonst Rezept.
    const pairs = isBeetFactory
      ? beetFulfillments(goods)
      : recipeFulfillments(goods, recipe)

    // Beet ohne beide Sorten: Waren bleiben (mit ggf. Siegpunkten).
    if (isBeetFactory && pairs === 0) {
      notes.push(`${field.label} unvollständig — bleibt liegen`)
      continue
    }

    let meter = fieldMeter(field)
    let income = 0
    for (let i = 0; i < pairs; i++) {
      const payout = meterDeliveryPayout(meter)
      income += payout.income
      meter = payout.meterAfter
    }
    setFieldMeter(field, meter)
    const paid = payFromBank(state, income)
    discard(state, goods)
    field.stack = keptPoints
    const claim = income - paid
    if (pairs > 0 || paid > 0) {
      notes.push(
        `${field.label} ${pairs}× → +${paid}¤${claim > 0 ? ` (+${claim} Forderung)` : ''} ${field.suit ? suitSymbol(field.suit) : ''}${meterLabel(meter)}`,
      )
    } else {
      notes.push(`${field.label} ohne Erfüllung`)
    }
  }
  if (notes.length) {
    log(
      state,
      `${player.name}: Eingangs-Abrechnung — ${notes.join('; ')}.`,
      'money',
    )
  }
}

/**
 * Zugende „Karten ziehen und Produzieren“:
 * 1. Regen/Getreide ziehen nach; Überfüllung → Quellenkollaps (Saatstand nicht).
 * 2. Jeder Ausgabestapel erhält eine offene Karte obenauf.
 * 3. Märkte und Küchen-/Saatstand-Eingänge abrechnen und leeren.
 * 4. Unter −8 Feld weg; über +5 Extra-Stapel (kein Markt-−1).
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
    // Saatstand: Nachziehen geht auf die Ausgabe, nicht auf den Eingang.
    if (isSeedBed(source)) continue
    const card = drawCard(next, source.suit)
    if (!card) continue
    source.stack.push(card)
    drawn.push(describeCard(card))
  }
  for (const source of fields) {
    if (source.kind === 'source' && !isSeedBed(source)) {
      collapseSourceIfOverloaded(next, source)
    }
  }

  const producedIds: FieldId[] = []
  const outputDrawn: string[] = []
  for (const field of fields) {
    const suit = outputSuit(field)
    if (!hasOutputStack(field) || !suit) continue
    if (!next.fields[field.id]) continue
    const outs = factoryOutputs(field)
    let any = false
    for (let i = 0; i < outs.length; i++) {
      const card = drawCard(next, suit)
      if (!card) break
      const revealedBefore = outputRevealedCount(field, i)
      outs[i]!.push(card)
      if (!field.outputsRevealed) field.outputsRevealed = []
      while (field.outputsRevealed.length <= i) field.outputsRevealed.push(0)
      field.outputsRevealed[i] = revealedBefore + 1
      outputDrawn.push(
        outs.length > 1
          ? `${field.label}#${i + 1} ${describeCard(card)}`
          : `${field.label} ${describeCard(card)}`,
      )
      any = true
      next.stats.productions += 1
    }
    if (any) producedIds.push(field.id)
  }
  next.producedIds = producedIds

  log(
    next,
    `${player.name} beendet den Zug: Quellen ${drawn.length ? drawn.join(' ') : 'keine'}; Ausgaben ${outputDrawn.length ? outputDrawn.join(', ') : 'keine'}.`,
    'info',
  )

  // Zuerst ablegen abrechnen, dann Über-/Unterversorgung.
  settleAndClearMarkets(next, player)
  settleAndClearInputs(next, player)

  applyEndOfTurnDemand(next)

  // Sieg: VP-Vorrat leer (auch hier nach Nachziehen/Kollaps prüfen).
  checkEndConditions(next, { checkWin: true })

  advanceTurn(next)
  return next
}

export function totalWealth(p: {
  money: number
  bankClaims: number
}): number {
  return p.money + p.bankClaims
}
