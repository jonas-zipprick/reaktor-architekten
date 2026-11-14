import type { FieldId, GameState, PlayerId } from '../types'
import { isSeedBed } from '../types'
import type {
  AuctionAction,
  BuyFieldCopyAction,
  BuyInfraAction,
  EndTurnAction,
  LagerOfferAction,
  MoveAction,
  SetFeeAction,
} from '../state/recordFormat'
import {
  BUYABLE_INFRA,
  canBuyFieldCopy,
  checkMove,
  factoryProduct,
  hasOutputStack,
  maxMovableRun,
  movableCard,
  nextBuyInfraPrice,
  nextFieldCopyPrice,
  suppliedMarketCount,
  type BuyableInfra,
  type MoveCheck,
  type StackLane,
} from '../state/rules'

/**
 * Bargeld-Reserve nach Käufen/Zügen, damit Ausgabe-Abholen noch möglich bleibt.
 */
const CASH_RESERVE = 4

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

export type BuyFieldCopyCandidate = {
  kind: 'buyFieldCopy'
  action: BuyFieldCopyAction
  price: number
}

export type TurnCandidate =
  | MoveCandidate
  | EndTurnCandidate
  | BuyInfraCandidate
  | BuyFieldCopyCandidate

/**
 * Sofortiges Rückgängig: Karten vom Ziel der letzten Bewegung zurück zur Quelle.
 * Jede Gegenrichtung (auch andere Anzahl) — bei LIFO liegt oben dieselbe Karte.
 */
export function isImmediateUndo(prev: MoveAction, next: MoveAction): boolean {
  return prev.from === next.to && prev.to === next.from
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
    if (!movableCard(state, from)) continue
    const field = state.fields[from]!
    const lanes: Array<StackLane | undefined> = hasOutputStack(field)
      ? ['output', 'input']
      : [undefined]
    for (const lane of lanes) {
      if (!movableCard(state, from, lane)) continue
      const max = maxMovableRun(field, lane)
      for (let count = 1; count <= max; count++) {
        for (const to of ids) {
          if (to === from) continue
          const check = checkMove(state, from, to, count, lane)
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
            },
            check,
          })
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

function canAfford(playerMoney: number, price: number): boolean {
  return playerMoney >= price && playerMoney - price >= CASH_RESERVE
}

/** Käufliche Infrastruktur, die der aktive Spieler sich leisten kann. */
export function listBuyInfra(state: GameState): BuyInfraCandidate[] {
  if (state.ended) return []
  const player = state.players[state.currentPlayerIndex]!
  const out: BuyInfraCandidate[] = []
  for (const item of BUYABLE_INFRA) {
    const price = nextBuyInfraPrice(state, item, player.id)
    if (price < 20 || !canAfford(player.money, price)) continue
    out.push({
      kind: 'buyInfra',
      price,
      action: { type: 'buyInfra', player: player.id, item },
    })
  }
  return out
}

/** Feldkopien bei Bedarf > 0, die der aktive Spieler sich leisten kann. */
export function listBuyFieldCopies(state: GameState): BuyFieldCopyCandidate[] {
  if (state.ended) return []
  const player = state.players[state.currentPlayerIndex]!
  const out: BuyFieldCopyCandidate[] = []
  for (const field of Object.values(state.fields)) {
    if (!canBuyFieldCopy(state, field.id)) continue
    const price = nextFieldCopyPrice(state, field.id)
    if (!canAfford(player.money, price)) continue
    out.push({
      kind: 'buyFieldCopy',
      price,
      action: { type: 'buyFieldCopy', player: player.id, at: field.id },
    })
  }
  return out
}

function countFields(
  state: GameState,
  pred: (f: (typeof state.fields)[string]) => boolean,
): number {
  return Object.values(state.fields).filter(pred).length
}

/**
 * Bewertung einer Kartenbewegung für den gierigen Bot. > 0 = lohnt sich.
 */
export function scoreMove(state: GameState, cand: MoveCandidate): number {
  const { check, move } = cand
  const card = check.card
  const from = state.fields[move.from]
  const to = state.fields[move.to]
  if (!card || !from || !to) return Number.NEGATIVE_INFINITY
  const player = state.players[state.currentPlayerIndex]!

  if (check.kind === 'deliver' || check.kind === 'feed') {
    let score = 10 + card.rank - check.cost * 5
    if (to.owner === player.id) score += 8
    if (check.kind === 'feed') score += 10
    if (check.kind === 'deliver') {
      score += 14
      // Lieferung hebt den Bedarf — wichtig für Versorgung > 0 am Zugende.
      const demand = to.demand ?? 0
      if (demand <= 0) score += 16
      else if (demand === 1) score += 10
      const need = state.marketsToWin - suppliedMarketCount(state)
      if (need > 0 && demand <= 0) score += 12
    }
    if (check.cost > 0 && player.money - check.cost < CASH_RESERVE) return -100
    return score
  }

  if (check.kind === 'park' || to.kind === 'storage') {
    let score = -12
    if (hasOutputStack(from) && factoryProduct(from)) score = 36
    else if (from.kind === 'source' && !isSeedBed(from) && from.stack.length > 1)
      score = 5
    else if (from.kind === 'storage') score = -40
    if (to.kind === 'storage' && to.suit && card.suit === to.suit) score += 10
    else if (to.kind === 'storage' && !to.suit) score += 2
    if (check.cost > 0 && player.money - check.cost < CASH_RESERVE) return -100
    return score - check.cost * 5
  }

  if (check.cost > 0 && player.money - check.cost < CASH_RESERVE) return -100
  return 4 - check.cost * 5 + (check.count - 1) * 3
}

/** Infrastrukturkauf: Lücken in der Kette schließen, Besitz aufbauen. */
export function scoreBuyInfra(
  state: GameState,
  cand: BuyInfraCandidate,
): number {
  const item = cand.action.item
  const price = cand.price
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
      if (mill === 0) score += grain > 0 ? 32 : 12
      else score -= 10
      break
    case 'mehlstand':
      if (flourMarket === 0) score += mill > 0 ? 30 : 10
      else score += 8 // zusätzliche Märkte fürs Siegziel
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
      const player = state.players[state.currentPlayerIndex]!
      const sheds = countFields(
        state,
        (f) => f.kind === 'storage' && f.owner === player.id && !f.suit,
      )
      if (sheds <= 1) score += 14
      else score -= 6 * (sheds - 1)
      break
    }
  }

  const supplied = suppliedMarketCount(state)
  const need = state.marketsToWin - supplied
  if (
    need > 0 &&
    (item === 'mehlstand' || item === 'konfituerenstand')
  ) {
    score += need <= 2 ? 24 : 12
  }

  // Obststand-Startketten: Mehl-Pfad erst nach Getreide sinnvoll.
  if (item === 'mehlmuehle' && fruitMarket > 0 && grain === 0) score -= 6
  return score
}

/** Feldkopie: Besitz bei positivem Bedarf; dringend nahe Kollaps. */
export function scoreBuyFieldCopy(
  state: GameState,
  cand: BuyFieldCopyCandidate,
): number {
  const field = state.fields[cand.action.at]
  if (!field) return Number.NEGATIVE_INFINITY
  const meter = field.demand ?? 0
  let score = 16 - cand.price * 0.3
  if (meter >= 4) score += 22
  else if (meter >= 2) score += 12
  else score += 6
  if (field.kind === 'market') {
    score += 4
    const need = state.marketsToWin - suppliedMarketCount(state)
    if (need > 0) score += need <= 2 ? 20 : 10
    // Versorgung über 0 halten / aufbauen hilft dem Siegziel.
    if ((field.demand ?? 0) <= 0) score += 8
  }
  if (field.owner && field.owner !== 'state') score -= 4
  return score
}

function scoreCandidate(state: GameState, cand: TurnCandidate): number {
  if (cand.kind === 'endTurn') return 0
  if (cand.kind === 'move') return scoreMove(state, cand)
  if (cand.kind === 'buyInfra') return scoreBuyInfra(state, cand)
  return scoreBuyFieldCopy(state, cand)
}

/**
 * Zugwahl: beste Bewegung/Kauf, sonst „Karten ziehen und Produzieren“.
 */
export function pickTurnAction(
  state: GameState,
  moves: MoveCandidate[],
  heuristic: number,
  rng: () => number,
  opts: { forceEnd?: boolean } = {},
): TurnCandidate {
  const end = endTurnCandidate(state)
  const buys = [...listBuyInfra(state), ...listBuyFieldCopies(state)]
  const allActs: TurnCandidate[] = [...moves, ...buys]

  if (opts.forceEnd || (!moves.length && !buys.length)) return end

  const h = Math.max(0, Math.min(1, heuristic))

  if (h <= 0) {
    const pool: TurnCandidate[] = [...allActs, end]
    return pool[Math.floor(rng() * pool.length)]!
  }

  const useGreedy = h >= 1 || rng() < h
  if (!useGreedy) {
    const pool: TurnCandidate[] = [...allActs]
    if (rng() < 0.25) pool.push(end)
    return pool[Math.floor(rng() * pool.length)]!
  }

  const scored = allActs.map((c) => ({ c, score: scoreCandidate(state, c) }))
  const best = Math.max(...scored.map((s) => s.score))
  if (best <= 0) return end
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
 * Gebühr eigener Betriebe (Mehrspieler): einmal pro Zug auf 1–3 setzen.
 * Einspieler: keine Gebühr (niemand zahlt).
 */
export function planFeeChange(
  state: GameState,
  heuristic: number,
  rng: () => number,
): SetFeeAction | null {
  if (state.ended || state.players.length < 2) return null
  const player = state.players[state.currentPlayerIndex]!
  const owned = Object.values(state.fields).filter(
    (f) => f.owner === player.id && f.kind !== 'storage',
  )
  if (!owned.length) return null

  const h = Math.max(0, Math.min(1, heuristic))
  if (h < 1 && rng() > h) return null

  // Unter den Betrieben mit zu niedriger Gebühr einen anheben.
  const targetFee = h >= 0.7 ? 2 + Math.floor(rng() * 2) : 1
  const candidates = owned.filter((f) => f.fee < targetFee)
  if (!candidates.length) return null
  const field = candidates[Math.floor(rng() * candidates.length)]!
  return {
    type: 'setFee',
    player: player.id as PlayerId,
    at: field.id as FieldId,
    fee: targetFee,
  }
}
