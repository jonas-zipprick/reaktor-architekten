import type { Card, FieldId, FieldState, GameState, PlayerId } from '../types'
import {
  beetFulfillments,
  jamFulfillments,
  isProductSuit,
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
  isPlayerHarvestComplete,
  isVictoryFieldComplete,
  maxMovableRun,
  movableCard,
  movableStack,
  nextBuyInfraPrice,
  playerVictoryFields,
  selectedPacket,
  type MoveCheck,
  type StackLane,
} from '../state/rules'

/**
 * Weicher Bargeld-Puffer nur fürs Scoring — filtert keine legalen Aktionen.
 */
const CASH_RESERVE = 4

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

function fromStackIndices(field: FieldState, lane?: StackLane): number[] {
  if (hasOutputStack(field) && lane === 'output') {
    const n = Math.max(1, factoryOutputs(field).length)
    return Array.from({ length: n }, (_, i) => i)
  }
  return [0]
}

function toStackIndices(_field: FieldState): number[] {
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
            if (to === from) continue
            for (const toStackIndex of toStackIndices(toField)) {
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

function ownVictoryField(state: GameState): FieldState | null {
  const id = state.players[state.currentPlayerIndex]!.id
  return playerVictoryFields(state, id)[0] ?? null
}

/** Wie stark bringt das Ablegen eine sortierte Ernte näher? */
function claimCompletionBonus(
  state: GameState,
  to: FieldState,
  packet: Card[],
): number {
  if (to.kind !== 'victory') return 0
  if (!packet.every((c) => isProductSuit(c.suit))) return 0
  const nextStack = [...to.stack, ...packet]
  const lead = nextStack[0]?.suit
  const mono =
    lead != null &&
    isProductSuit(lead) &&
    nextStack.every((c) => c.suit === lead)
  const mixed = nextStack.some((c) => c.suit !== packet[0]!.suit)
  const playerId = state.players[state.currentPlayerIndex]!.id
  // Temporär den Stapel setzen, um die Siegbedingung zu prüfen.
  const saved = to.stack
  to.stack = nextStack
  const wouldWin = isPlayerHarvestComplete(state, playerId)
  to.stack = saved
  if (wouldWin) return 90
  if (mono) return isVictoryFieldComplete({ ...to, stack: nextStack }) ? 36 : 24
  if (mixed || to.stack.length === 0) {
    // Leeres Feld mit einer Sorte starten: gut.
    if (to.stack.length === 0 && packet.every((c) => c.suit === packet[0]!.suit)) {
      return 18
    }
  }
  return -16
}

function pendingSettlementCards(state: GameState): number {
  let n = 0
  for (const f of Object.values(state.fields)) {
    if ((f.kind === 'factory' || isSeedBed(f)) && f.stack.length) {
      n += f.stack.length
    }
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
  if (to.kind === 'factory' && to.suit === 'steel') {
    return {
      before: jamFulfillments(beforeStack),
      after: jamFulfillments(afterStack),
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

  score += 4
  return score
}

/**
 * Bewertung einer Kartenbewegung für den gierigen Bot.
 * Primärziel: Mehl, Obst und Konfitüre in ihre Erntespalten bringen.
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
  let score = 0

  const fromInput =
    (from.kind === 'factory' || isSeedBed(from)) && move.lane === 'input'
  const fromFactoryOut =
    hasOutputStack(from) &&
    move.lane !== 'input' &&
    Boolean(factoryProduct(from, fromStackIndex))

  // Endprodukt auf die Erntespalte legen oder zwischen Spalten sortieren.
  if (check.kind === 'claim') {
    const packet = movePacket(state, move, count)
    const gain = claimCompletionBonus(state, to, packet)
    score = 10 + count * 4 - check.cost * 3
    score += gain
    if (need > 0) score += 12

    if (from.kind === 'victory') {
      if (isVictoryFieldComplete(from)) return -80
      const fromSuit = from.stack[0]?.suit
      const leavingSorted =
        isVictoryFieldComplete(from) === false &&
        fromSuit != null &&
        from.stack.every((c) => c.suit === fromSuit) &&
        packet.every((c) => c.suit === fromSuit)
      if (leavingSorted && gain < 90) score -= 30
      else if (gain >= 90) score += 10
    } else if (from.kind === 'storage') {
      score += 16
    } else if (fromFactoryOut) {
      score += 12
    }

    if (gain >= 90) score += 40

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
      const isJam = to.kind === 'factory' && to.suit === 'steel'
      if (isBeet || isJam) {
        const suits = new Set([...to.stack, ...packet].map((c) => c.suit))
        const needA = isBeet ? 'energy' : 'clubs'
        const needB = isBeet ? 'hearts' : 'energy'
        const hasA = suits.has(needA)
        const hasB = suits.has(needB)
        if (hasA && hasB) score += 20
        else if (hasA || hasB) score += 10
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

  if (fromFactoryOut) {
    score = 14
  } else if (relievingSource) {
    const len = from.stack.length
    score = 6 + Math.max(0, len - 4) * 4
  } else if (from.kind === 'victory') {
    if (isVictoryFieldComplete(from)) return -80
    score = to.kind === 'storage' ? -20 : -30
  } else if (from.kind === 'storage') {
    if (isProductSuit(card.suit) && ownVictoryField(state)) {
      score = -18
    } else {
      score = -40
    }
  }

  if (to.kind === 'source' && !isSeedBed(to)) {
    score -= 20
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
  const jamKitchen = countFields(
    state,
    (f) => f.kind === 'factory' && f.suit === 'steel',
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
    case 'konfituerenkueche':
      if (jamKitchen === 0) score += beet > 0 ? 26 : 8
      else score -= 10
      break
  }

  const need = victoryColumnsNeed(state)
  // Kette zuerst, solange die Erntespalten noch offen sind.
  if (need > 0) {
    if (item === 'getreidefeld' && grain === 0) score += 18
    if (item === 'mehlmuehle' && mill === 0 && grain > 0) score += 22
    if (item === 'konfituerenkueche' && jamKitchen === 0 && beet > 0) score += 18
  }

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
