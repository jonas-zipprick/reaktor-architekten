import type { Card, FieldId, FieldState, GameState, PlayerId } from '../types'
import {
  beetFulfillments,
  isPointsSuit,
  isSeedBed,
  OVERSUPPLY_COLLAPSE,
  recipeFulfillments,
  SEED_BED_RECIPE,
  VICTORY_COLUMN_COUNT,
} from '../types'
import type {
  AuctionAction,
  BuyInfraAction,
  EndTurnAction,
  GiftAction,
  LagerOfferAction,
  MoveAction,
  SetFeeAction,
} from '../state/recordFormat'
import {
  BUYABLE_INFRA,
  checkMove,
  completedVictoryColumns,
  factoryOutputs,
  factoryProduct,
  hasOutputStack,
  isVictoryColumnComplete,
  marketInputs,
  maxMovableRun,
  movableCard,
  movableStack,
  nextBuyInfraPrice,
  selectedPacket,
  victoryColumns,
  type MoveCheck,
  type StackLane,
} from '../state/rules'

/**
 * Weicher Bargeld-Puffer nur fürs Scoring — filtert keine legalen Aktionen.
 */
const CASH_RESERVE = 4

/** Quellen kollabieren am Zugende bei mehr als so vielen Karten (nach Nachziehen). */
const SOURCE_STACK_LIMIT = 8

/** Max. Geschenkbetrag pro Gift-Kandidat (Coverage + Anti-Spam). */
const GIFT_AMOUNT_CAP = 5

/** Gebührenkorridor für den Bot. */
const FEE_MAX = 3

/** Legal card move with fees and delivery costs already computed. */
export type MoveCandidate = {
  kind: 'move'
  move: MoveAction
  check: MoveCheck
}

export type EndTurnCandidate = {
  kind: 'endTurn'
  action: EndTurnAction
}

export type BuyInfraCandidate = {
  kind: 'buyInfra'
  action: BuyInfraAction
  price: number
}

export type GiftCandidate = {
  kind: 'gift'
  action: GiftAction
}

export type TurnCandidate =
  | MoveCandidate
  | EndTurnCandidate
  | BuyInfraCandidate
  | GiftCandidate

function marketPending(field: FieldState): number {
  return marketInputs(field).reduce((s, inp) => s + inp.length, 0)
}

function fromStackIndices(field: FieldState, lane?: StackLane): number[] {
  if (field.kind === 'victory') {
    return victoryColumns(field).map((_, i) => i)
  }
  if (field.kind === 'market') {
    if (lane === 'output') {
      const n = Math.max(1, factoryOutputs(field).length)
      return Array.from({ length: n }, (_, i) => i)
    }
    return marketInputs(field).map((_, i) => i)
  }
  if (hasOutputStack(field) && lane === 'output') {
    const n = Math.max(1, factoryOutputs(field).length)
    return Array.from({ length: n }, (_, i) => i)
  }
  return [0]
}

function toStackIndices(field: FieldState): number[] {
  if (field.kind === 'victory') {
    return victoryColumns(field).map((_, i) => i)
  }
  if (field.kind === 'market') {
    return marketInputs(field).map((_, i) => i)
  }
  return [0]
}

/**
 * Sofortiges Rückgängig: Karten vom Ziel der letzten Bewegung zurück zur Quelle.
 * Jede Gegenrichtung (auch andere Anzahl) — bei LIFO liegt oben dieselbe Karte.
 */
export function isImmediateUndo(prev: MoveAction, next: MoveAction): boolean {
  return (
    prev.from === next.to &&
    prev.to === next.from &&
    (prev.stackIndex ?? 0) === (next.toStackIndex ?? 0) &&
    (prev.toStackIndex ?? 0) === (next.stackIndex ?? 0)
  )
}

/** Kandidaten entfernen, die den zuletzt ausgeführten Zug sofort umkehren. */
export function rejectImmediateUndos(
  moves: MoveCandidate[],
  lastMove: MoveAction | null | undefined,
): MoveCandidate[] {
  if (!lastMove) return moves
  return moves.filter((m) => !isImmediateUndo(lastMove, m.move))
}

/** All affordable legal card moves of the active player. */
export function listLegalMoves(state: GameState): MoveCandidate[] {
  if (state.ended) return []
  const player = state.players[state.currentPlayerIndex]!.id
  const out: MoveCandidate[] = []
  const ids = Object.keys(state.fields)

  for (const from of ids) {
    const field = state.fields[from]!
    const lanes: Array<StackLane | undefined> =
      field.kind === 'victory'
        ? [undefined]
        : hasOutputStack(field)
          ? ['output', 'input']
          : [undefined]
    for (const lane of lanes) {
      for (const stackIndex of fromStackIndices(field, lane)) {
        if (!movableCard(state, from, lane, stackIndex)) continue
        const max = maxMovableRun(field, lane, stackIndex)
        for (let count = 1; count <= max; count++) {
          for (const to of ids) {
            const toField = state.fields[to]!
            // VP-Feld: Umsortieren zwischen Spalten erlaubt.
            if (to === from && field.kind !== 'victory') continue
            for (const toStackIndex of toStackIndices(toField)) {
              if (to === from && toStackIndex === stackIndex) continue
              const check = checkMove(state, from, to, count, lane, {
                stackIndex,
                toStackIndex,
              })
              if (!check.ok) continue
              out.push({
                kind: 'move',
                move: {
                  type: 'move',
                  player,
                  from,
                  to,
                  ...(count > 1 ? { count } : {}),
                  ...(lane === 'input' ? { lane } : {}),
                  ...(stackIndex > 0 ? { stackIndex } : {}),
                  ...(toStackIndex > 0 ? { toStackIndex } : {}),
                },
                check,
              })
            }
          }
        }
      }
    }
  }

  return out
}

export function endTurnCandidate(state: GameState): EndTurnCandidate {
  return {
    kind: 'endTurn',
    action: {
      type: 'endTurn',
      player: state.players[state.currentPlayerIndex]!.id,
    },
  }
}

/** Käufliche Infrastruktur, die der aktive Spieler bezahlen kann. */
export function listBuyInfra(state: GameState): BuyInfraCandidate[] {
  if (state.ended) return []
  const player = state.players[state.currentPlayerIndex]!
  const out: BuyInfraCandidate[] = []
  for (const item of BUYABLE_INFRA) {
    const price = nextBuyInfraPrice(state, item, player.id)
    if (price < 20 || player.money < price) continue
    out.push({
      kind: 'buyInfra',
      price,
      action: { type: 'buyInfra', player: player.id, item },
    })
  }
  return out
}

/** Mehrspieler: kleine Geschenke (Coverage der legalen Gift-Aktion). */
export function listGifts(state: GameState): GiftCandidate[] {
  if (state.ended || state.players.length < 2) return []
  const player = state.players[state.currentPlayerIndex]!
  if (player.money < 1) return []
  const maxAmount = Math.min(GIFT_AMOUNT_CAP, player.money)
  const out: GiftCandidate[] = []
  for (const other of state.players) {
    if (other.id === player.id) continue
    for (let amount = 1; amount <= maxAmount; amount++) {
      out.push({
        kind: 'gift',
        action: {
          type: 'gift',
          player: player.id,
          to: other.id,
          amount,
        },
      })
    }
  }
  return out
}

function countFields(
  state: GameState,
  pred: (f: FieldState) => boolean,
): number {
  return Object.values(state.fields).filter(pred).length
}

function cashReserveMalus(moneyAfter: number): number {
  if (moneyAfter >= CASH_RESERVE) return 0
  return -4 * (CASH_RESERVE - Math.max(0, moneyAfter))
}

/** Fehlende volle VP-Spalten des aktiven Spielers. */
function victoryColumnsNeed(state: GameState): number {
  const id = state.players[state.currentPlayerIndex]!.id
  return VICTORY_COLUMN_COUNT - completedVictoryColumns(state, id)
}

/** Nach Settle (+1 je Karte); kein automatisches Markt-−1 mehr. */
function projectedMarketAfterSettle(
  demand: number,
  stackLen: number,
  extraCards = 0,
): number {
  return demand + stackLen + extraCards
}

function ownVictoryField(state: GameState): FieldState | null {
  const id = state.players[state.currentPlayerIndex]!.id
  const field = state.fields[`sieg-${id}`]
  return field?.kind === 'victory' ? field : null
}

/** Wie stark verbessert das Ablegen die VP-Spalte (Richtung „endet auf 2“)? */
function claimCompletionBonus(
  to: FieldState,
  toStackIndex: number,
  packet: Card[],
): number {
  if (to.kind !== 'victory') return 0
  const col = victoryColumns(to)[Math.max(0, toStackIndex)] ?? []
  const next = [...col, ...packet]
  if (isVictoryColumnComplete(next)) return 70
  const lead = packet[0]
  const top = next[next.length - 1]
  if (!top || !isPointsSuit(top.suit)) return 0
  // Leere Spalte: mit 7 starten (nur so sind 6 Karten 7→2 erreichbar).
  if (col.length === 0) {
    const r = lead?.rank ?? 7
    if (r === 7) return 24
    if (r === 6) return 4
    return 2 - r // hohe Fehlstarts vermeiden
  }
  // Verlängern Richtung voller 7→2-Spalte.
  if (top.rank === 3) return 28
  if (top.rank === 4) return 16
  if (top.rank === 5) return 10
  if (top.rank === 6) return 6
  return 2
}

function pendingSettlementCards(state: GameState): number {
  let n = 0
  for (const f of Object.values(state.fields)) {
    if (f.kind === 'market') n += marketPending(f)
    if ((f.kind === 'factory' || isSeedBed(f)) && f.stack.length) {
      n += f.stack.length
    }
  }
  return n
}

function sourcesNearCollapse(state: GameState): number {
  let n = 0
  for (const f of Object.values(state.fields)) {
    if (f.kind !== 'source' || isSeedBed(f)) continue
    // Nachziehen +1 → Kollaps wenn length > SOURCE_STACK_LIMIT.
    if (f.stack.length >= SOURCE_STACK_LIMIT) n += 1
  }
  return n
}

function movePacket(
  state: GameState,
  move: MoveAction,
  count: number,
): Card[] {
  const from = state.fields[move.from]
  if (!from) return []
  const stack = movableStack(from, move.lane, move.stackIndex ?? 0)
  return selectedPacket(stack, count)
}

function feedFulfillmentDelta(
  to: FieldState,
  packet: Card[],
): { before: number; after: number } {
  const beforeStack = to.stack
  const afterStack = [...beforeStack, ...packet]
  if (to.kind === 'factory' && to.suit === 'clubs') {
    return {
      before: beetFulfillments(beforeStack),
      after: beetFulfillments(afterStack),
    }
  }
  const recipe = to.recipe ?? (isSeedBed(to) ? SEED_BED_RECIPE : {})
  return {
    before: recipeFulfillments(beforeStack, recipe),
    after: recipeFulfillments(afterStack, recipe),
  }
}

/**
 * Zugende: Abrechnung, Produktion, Nachziehen — oft wichtiger als Parken.
 * Sieg kommt über volle VP-Spalten, nicht über Markt-Versorgung.
 */
export function scoreEndTurn(state: GameState): number {
  let score = 2
  const pending = pendingSettlementCards(state)
  if (pending > 0) score += 10 + pending * 3

  const need = victoryColumnsNeed(state)
  const done = VICTORY_COLUMN_COUNT - need
  score += done * 6
  // Neue ★ aufdecken / Ketten produzieren, solange Spalten offen sind.
  if (need > 0) score += 8

  const collapsing = sourcesNearCollapse(state)
  if (collapsing > 0) {
    score -= 25 * collapsing
  } else {
    score += 4
  }

  return score
}

/**
 * Bewertung einer Kartenbewegung für den gierigen Bot.
 * Primärziel: VP-Spalten füllen (absteigend bis 2); Märkte liefern ★ und Einkommen.
 */
export function scoreMove(state: GameState, cand: MoveCandidate): number {
  const { check, move } = cand
  const card = check.card
  const from = state.fields[move.from]
  const to = state.fields[move.to]
  if (!card || !from || !to) return Number.NEGATIVE_INFINITY
  const player = state.players[state.currentPlayerIndex]!
  const count = check.count
  const need = victoryColumnsNeed(state)
  const fromStackIndex = move.stackIndex ?? 0
  const toStackIndex = move.toStackIndex ?? 0
  let score = 0

  // Markteingang vor Abrechnung leeren — vernichtet Einkommen.
  if (from.kind === 'market' && move.lane === 'input') {
    return -90 - count * 5
  }

  const fromInput =
    (from.kind === 'factory' || isSeedBed(from)) && move.lane === 'input'
  const fromMarketVp =
    from.kind === 'market' && move.lane !== 'input'
  const fromFactoryOut =
    hasOutputStack(from) &&
    from.kind !== 'market' &&
    move.lane !== 'input' &&
    Boolean(factoryProduct(from, fromStackIndex))

  // Siegpunkte auf eigene Spalte legen / umsortieren.
  if (check.kind === 'claim') {
    const packet = movePacket(state, move, count)
    const gain = claimCompletionBonus(to, toStackIndex, packet)
    score = 10 + count * 4 - check.cost * 3
    score += gain
    if (need <= 1) score += 24
    else if (need <= 2) score += 12

    if (from.kind === 'victory') {
      const fromCol = victoryColumns(from)[fromStackIndex] ?? []
      // Fertige Spalte nie anfassen.
      if (isVictoryColumnComplete(fromCol)) return -140
      // Umsortieren nur belohnen, wenn eine Spalte dadurch fertig wird.
      if (gain < 70) score -= 45 + fromCol.length * 3
      else score += 10
    } else if (fromMarketVp) {
      score += 12
      const demand = from.demand ?? 0
      if (demand <= -4 && check.cost > 0) score -= 16
    } else if (from.kind === 'storage') {
      score += 16
    }

    // Siegzug: letzte Spalte vollmachen.
    if (need === 1 && gain >= 70) score += 90

    score += cashReserveMalus(player.money - check.cost)
    return score
  }

  if (check.kind === 'deliver') {
    score = 12 + card.rank - check.cost * 4
    if (to.owner === player.id) score += 4

    const demand = to.demand ?? 0
    const pending = marketPending(to)
    const after = projectedMarketAfterSettle(demand, pending, count)
    const before = projectedMarketAfterSettle(demand, pending, 0)

    if (after > OVERSUPPLY_COLLAPSE) score += 8

    // Bedarf anheben (Lieferung) macht spätere ★-Züge günstiger.
    if (demand < 0) {
      let income = 0
      let m = demand
      for (let i = 0; i < pending + count; i++) {
        if (m < 0) income += -m
        m += 1
      }
      score += Math.min(40, income * 2.5)
      // Stark negativ: Liefern wichtiger als weitere ★-Käufe.
      if (demand <= -3) score += 14
    } else if (after > before) {
      score += 4
    }

    if (after > OVERSUPPLY_COLLAPSE) score += need > 0 ? 6 : 2

    score += cashReserveMalus(player.money - check.cost)
    return score
  }

  if (check.kind === 'feed') {
    score = 8 + card.rank - check.cost * 4
    if (to.owner === player.id) score += 4

    const packet = movePacket(state, move, count)
    const { before, after } = feedFulfillmentDelta(to, packet)
    const delta = after - before
    const seedBed = isSeedBed(to)

    if (seedBed) {
      if (delta > 0) score += 12
      else score += 2
    } else if (delta > 0) {
      score += 24 + delta * 8
    } else {
      const isBeet = to.kind === 'factory' && to.suit === 'clubs'
      if (isBeet) {
        const suits = new Set([...to.stack, ...packet].map((c) => c.suit))
        const hasEnergy = suits.has('energy')
        const hasSeed = suits.has('hearts')
        if (hasEnergy && hasSeed) score += 20
        else if (hasEnergy || hasSeed) score += 10
        else score -= 4
      } else {
        score += 4
      }
    }

    if (after > 0) {
      const meter = (to.demand ?? 0) + after
      if (meter > OVERSUPPLY_COLLAPSE) score += 6
    }

    score += cashReserveMalus(player.money - check.cost)
    return score
  }

  // park / Shift
  score = -14
  if (fromInput) score -= 45

  const relievingSource =
    from.kind === 'source' && !isSeedBed(from) && from.stack.length > 1

  if (fromMarketVp) {
    // ★ parken (nicht claimen): nur Zwischenlager, klar unter claim halten.
    score = 6 + count * 2
    if (to.kind === 'storage' && to.owner === player.id && isPointsSuit(card.suit)) {
      // 2er lieber direkt claimen — Parken leicht dämpfen.
      score += card.rank === 2 ? -8 : 8
    }
    const demand = from.demand ?? 0
    if (demand <= -4 && check.cost > 0) score -= 15
  } else if (fromFactoryOut) {
    score = 14
  } else if (relievingSource) {
    const len = from.stack.length
    score = 6 + Math.max(0, len - 4) * 4
    if (len >= SOURCE_STACK_LIMIT - 1) score += 28
    if (len >= SOURCE_STACK_LIMIT) score += 20
  } else if (from.kind === 'victory') {
    const fromCol = victoryColumns(from)[fromStackIndex] ?? []
    if (isVictoryColumnComplete(fromCol)) return -140
    // ★ vom VP-Feld auf Schuppen: fast nie.
    score = to.kind === 'storage' ? -55 : -30
  } else if (from.kind === 'storage') {
    if (isPointsSuit(card.suit) && ownVictoryField(state)) {
      score = -30 // ★ gehören aufs VP-Feld (claim)
    } else {
      score = -40
    }
  }

  if (to.kind === 'source' && !isSeedBed(to)) {
    score -= 20
    if (to.stack.length >= SOURCE_STACK_LIMIT - 1) score -= 25
  }

  if (to.kind === 'storage' && to.suit && card.suit === to.suit) score += 8
  else if (to.kind === 'storage' && !to.suit) score += 2

  score -= check.cost * 4
  score += cashReserveMalus(player.money - check.cost)
  return score
}

/** Infrastrukturkauf: Lücken in der Kette schließen, Besitz aufbauen. */
export function scoreBuyInfra(
  state: GameState,
  cand: BuyInfraCandidate,
): number {
  const item = cand.action.item
  const price = cand.price
  const player = state.players[state.currentPlayerIndex]!
  let score = 18 - price * 0.35

  const grain = countFields(
    state,
    (f) => f.kind === 'source' && f.suit === 'spades',
  )
  const mill = countFields(
    state,
    (f) => f.kind === 'factory' && f.suit === 'diamonds',
  )
  const flourMarket = countFields(
    state,
    (f) => f.kind === 'market' && f.suit === 'diamonds',
  )
  const jamKitchen = countFields(
    state,
    (f) => f.kind === 'factory' && f.suit === 'steel',
  )
  const jamMarket = countFields(
    state,
    (f) => f.kind === 'market' && f.suit === 'steel',
  )
  const fruitMarket = countFields(
    state,
    (f) => f.kind === 'market' && f.suit === 'clubs',
  )
  const beet = countFields(
    state,
    (f) => f.kind === 'factory' && f.suit === 'clubs',
  )

  switch (item) {
    case 'getreidefeld':
      if (grain === 0) score += 28
      else score -= 8
      break
    case 'mehlmuehle':
      if (mill === 0) score += grain > 0 ? 32 : 8
      else score -= 10
      break
    case 'mehlstand':
      if (flourMarket === 0) score += mill > 0 ? 30 : 10
      else score += 8
      break
    case 'konfituerenkueche':
      if (jamKitchen === 0) score += beet > 0 ? 26 : 8
      else score -= 10
      break
    case 'konfituerenstand':
      if (jamMarket === 0) score += jamKitchen > 0 ? 28 : 8
      else score += 8
      break
    case 'schuppen': {
      const sheds = countFields(
        state,
        (f) => f.kind === 'storage' && f.owner === player.id && !f.suit,
      )
      if (sheds <= 1) score += 14
      else score -= 6 * (sheds - 1)
      break
    }
  }

  const need = victoryColumnsNeed(state)
  // Märkte = zusätzliche ★-Ausgaben + Einkommen → VP-Ziel.
  if (item === 'mehlstand' && mill > 0) score += need > 0 ? 36 : 12
  else if (item === 'konfituerenstand' && jamKitchen > 0)
    score += need > 0 ? 34 : 12
  else if (need > 0 && (item === 'mehlstand' || item === 'konfituerenstand')) {
    score += need <= 2 ? 18 : 10
  }

  // Kette zuerst, solange VP-Spalten noch offen sind.
  if (need > 0) {
    if (item === 'getreidefeld' && grain === 0) score += 18
    if (item === 'mehlmuehle' && mill === 0 && grain > 0) score += 22
    if (item === 'konfituerenkueche' && jamKitchen === 0 && beet > 0) score += 18
  }

  if (item === 'mehlmuehle' && fruitMarket > 0 && grain === 0) score -= 10
  score += cashReserveMalus(player.money - price)
  return score
}

export function scoreGift(state: GameState, cand: GiftCandidate): number {
  const player = state.players[state.currentPlayerIndex]!
  const receiver = state.players.find((p) => p.id === cand.action.to)
  if (!receiver) return Number.NEGATIVE_INFINITY
  // Shared win: selten sinnvoll — nur wenn Empfänger handlungsunfähig wirkt.
  if (receiver.money === 0 && player.money - cand.action.amount >= CASH_RESERVE) {
    return 6 - cand.action.amount
  }
  return -20 - cand.action.amount
}

function scoreCandidate(state: GameState, cand: TurnCandidate): number {
  if (cand.kind === 'endTurn') return scoreEndTurn(state)
  if (cand.kind === 'move') return scoreMove(state, cand)
  if (cand.kind === 'buyInfra') return scoreBuyInfra(state, cand)
  return scoreGift(state, cand)
}

/**
 * Zugwahl: beste Bewegung/Kauf/Gift/Zugende laut Heuristik.
 */
export function pickTurnAction(
  state: GameState,
  moves: MoveCandidate[],
  heuristic: number,
  rng: () => number,
  opts: { forceEnd?: boolean } = {},
): TurnCandidate {
  const end = endTurnCandidate(state)
  const buys = listBuyInfra(state)
  const gifts = listGifts(state)
  const allActs: TurnCandidate[] = [...moves, ...buys, ...gifts]

  if (opts.forceEnd) return end
  if (!allActs.length) return end

  const h = Math.max(0, Math.min(1, heuristic))

  if (h <= 0) {
    const pool: TurnCandidate[] = [...allActs, end]
    return pool[Math.floor(rng() * pool.length)]!
  }

  const useGreedy = h >= 1 || rng() < h
  if (!useGreedy) {
    // Explore: endTurn immer dabei.
    const pool: TurnCandidate[] = [...allActs, end]
    return pool[Math.floor(rng() * pool.length)]!
  }

  const scored = [...allActs, end].map((c) => ({
    c,
    score: scoreCandidate(state, c),
  }))
  const best = Math.max(...scored.map((s) => s.score))
  const top = scored.filter((s) => s.score === best)
  return top[Math.floor(rng() * top.length)]!.c
}

/**
 * Höchstens eine Auktion pro Zug — Infrastruktur ist persönlich / käuflich.
 */
export function planAuction(
  _state: GameState,
  _heuristic: number,
  _rng: () => number,
): AuctionAction | null {
  return null
}

/** @deprecated Exp-10 entfällt. */
export function planLagerOffer(
  _state: GameState,
  _heuristic: number,
  _rng: () => number,
): LagerOfferAction | null {
  return null
}

/**
 * Gebühr eigener Betriebe (Mehrspieler): einmal pro Zug.
 * Bei offenen VP-Spalten eher 0 (Durchsatz); sonst leicht anheben.
 */
export function planFeeChange(
  state: GameState,
  heuristic: number,
  rng: () => number,
): SetFeeAction | null {
  if (state.ended || state.players.length < 2) return null
  const player = state.players[state.currentPlayerIndex]!
  const owned = Object.values(state.fields).filter(
    (f) =>
      f.owner === player.id && f.kind !== 'storage' && f.kind !== 'victory',
  )
  if (!owned.length) return null

  const h = Math.max(0, Math.min(1, heuristic))
  if (h < 1 && rng() > h) return null

  const need = victoryColumnsNeed(state)
  if (need > 0) {
    const inflated = owned.filter((f) => f.fee > 0)
    if (!inflated.length) return null
    const field = inflated[Math.floor(rng() * inflated.length)]!
    return {
      type: 'setFee',
      player: player.id as PlayerId,
      at: field.id as FieldId,
      fee: 0,
    }
  }

  const targetFee = h >= 0.7 ? 1 + Math.floor(rng() * FEE_MAX) : 1
  const candidates = owned.filter((f) => f.fee !== targetFee)
  if (!candidates.length) return null
  const raise = candidates.filter((f) => f.fee < targetFee)
  const pool = raise.length ? raise : candidates
  const field = pool[Math.floor(rng() * pool.length)]!
  return {
    type: 'setFee',
    player: player.id as PlayerId,
    at: field.id as FieldId,
    fee: targetFee,
  }
}
