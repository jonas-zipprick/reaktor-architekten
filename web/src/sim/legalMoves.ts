import type { Card, FieldState, GameState, PlayerId } from '../types'
import {
  beetFulfillments,
  CROP_SUITS,
  isCommunalDepot,
  isMarketField,
  isPersonalGarden,
  isProductSuit,
  isRegen,
  isCropSuit,
  isSeedBed,
  isWaterTrade,
  MARKET_PRICES,
  marketFieldId,
  marketStallAffordable,
  recipeFulfillments,
  seedBedFulfillments,
  SEED_BED_RECIPE,
  TENSION_MAX,
  TENSION_MIN,
  victoryColumnCount,
  WATER_TRADE_RECIPE,
} from '../types'
import type {
  AuctionAction,
  BuyInfraAction,
  EndTurnAction,
  GiftAction,
  LagerOfferAction,
  MoveAction,
} from '../state/recordFormat'
import {
  BUYABLE_INFRA,
  checkMove,
  completedVictoryColumns,
  factoryOutputs,
  factoryProduct,
  harvestStackDiversity,
  hasOutputStack,
  isPlayerHarvestComplete,
  isVictoryFieldComplete,
  maxMovableRun,
  movableCard,
  movableStack,
  nextBuyInfraPrice,
  moneyVictoryScore,
  playerHarvestScore,
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

/** Legal card move with delivery costs already computed. */
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
      field.kind === 'victory' || isMarketField(field)
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

function cashReserveMalus(moneyAfter: number): number {
  if (moneyAfter >= CASH_RESERVE) return 0
  return -4 * (CASH_RESERVE - Math.max(0, moneyAfter))
}

/** Fehlende volle VP-Spalten des aktiven Spielers. */
function victoryColumnsNeed(state: GameState): number {
  const id = state.players[state.currentPlayerIndex]!.id
  return (
    victoryColumnCount(state.players.length) -
    completedVictoryColumns(state, id)
  )
}

function ownVictoryField(state: GameState): FieldState | null {
  const id = state.players[state.currentPlayerIndex]!.id
  return playerVictoryFields(state, id)[0] ?? null
}

function activePlayerId(state: GameState): PlayerId {
  return state.players[state.currentPlayerIndex]!.id
}

/** Eigene Beet-Ernte-Sorte (Sitzplatz). */
function ownCropSuit(state: GameState): (typeof CROP_SUITS)[number] | null {
  const seat = state.currentPlayerIndex
  return CROP_SUITS[seat] ?? null
}

/**
 * Karten, die der Markt beim nächsten Marktwurf kaufen würde
 * (nach dem Pflicht-Schritt Preisanzeige +1).
 */
function marketSellableNow(
  state: GameState,
): { own: number; foreign: number; cheapestOwnPrice: number | null } {
  const afterRise = Math.min(
    TENSION_MAX,
    Math.max(TENSION_MIN, state.marketDemand + 1),
  )
  let own = 0
  let foreign = 0
  let cheapestOwnPrice: number | null = null
  if (afterRise < 1) return { own, foreign, cheapestOwnPrice }
  const me = activePlayerId(state)
  for (const price of MARKET_PRICES) {
    if (!marketStallAffordable(price, afterRise)) continue
    const field = state.fields[marketFieldId(price)]
    if (!field || !isMarketField(field)) continue
    for (const card of field.stack) {
      const payee = card.marketPlacedBy ?? null
      if (payee === me) {
        own += 1
        if (cheapestOwnPrice == null || price < cheapestOwnPrice) {
          cheapestOwnPrice = price
        }
      } else {
        foreign += 1
      }
    }
  }
  return { own, foreign, cheapestOwnPrice }
}

/** Ablegen auf Ernte: Folge füllen + Sortenvielfalt (SP) belohnen. */
function claimCompletionBonus(
  state: GameState,
  to: FieldState,
  packet: Card[],
): number {
  if (to.kind !== 'victory') return 0
  if (!packet.every((c) => isProductSuit(c.suit))) return 0
  const nextStack = [...to.stack, ...packet]
  const playerId = state.players[state.currentPlayerIndex]!.id
  const beforeComplete = isVictoryFieldComplete(to)
  const afterComplete = isVictoryFieldComplete({ ...to, stack: nextStack })
  const beforeDiv = harvestStackDiversity(to.stack)
  const afterDiv = harvestStackDiversity(nextStack)

  const saved = to.stack
  to.stack = nextStack
  const wouldTriggerEnd = isPlayerHarvestComplete(state, playerId)
  const scoreAfter = playerHarvestScore(state, playerId)
  to.stack = saved
  const scoreBefore = playerHarvestScore(state, playerId)

  let score = 4
  if (afterComplete && !beforeComplete) score += 28 + afterDiv * 6
  else if (nextStack.length > to.stack.length) {
    score += 10 + nextStack.length * 3
    if (afterDiv > beforeDiv) score += 8 + afterDiv * 4
  }
  if (scoreAfter > scoreBefore) score += (scoreAfter - scoreBefore) * 10
  // Dritten Stapel voll = Partie kann beim Zugende enden.
  if (wouldTriggerEnd) score += 24
  return score
}

function pendingSettlementCards(state: GameState): number {
  let n = 0
  for (const f of Object.values(state.fields)) {
    if ((f.kind === 'factory' || isCommunalDepot(f)) && f.stack.length) {
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
  if (isPersonalGarden(to)) {
    return {
      before: beetFulfillments(beforeStack),
      after: beetFulfillments(afterStack),
    }
  }
  if (isSeedBed(to)) {
    return {
      before: seedBedFulfillments(beforeStack),
      after: seedBedFulfillments(afterStack),
    }
  }
  const recipe =
    to.recipe ?? (isWaterTrade(to) ? WATER_TRADE_RECIPE : SEED_BED_RECIPE)
  return {
    before: recipeFulfillments(beforeStack, recipe),
    after: recipeFulfillments(afterStack, recipe),
  }
}

/**
 * Zugende: Abrechnung, Produktion, Nachziehen — oft wichtiger als Parken.
 * Mit drei vollen Erntefeldern: Zugende löst die Wertung aus → stark belohnen.
 */
export function scoreEndTurn(state: GameState): number {
  const me = activePlayerId(state)
  let score = 2
  const pending = pendingSettlementCards(state)
  if (pending > 0) score += 10 + pending * 3

  // Eigene Beete mit erfülltem Rezept (Wasser+Saat) → gratis Produktion.
  for (const f of Object.values(state.fields)) {
    if (!isPersonalGarden(f) || f.owner !== me) continue
    const n = beetFulfillments(f.stack)
    if (n > 0) score += 10 + n * 5
  }

  // Markt kann eigene Ware kaufen — Markt-Würfel > 0 (4 von 6).
  const sell = marketSellableNow(state)
  if (sell.own > 0) score += 6 + sell.own * 4
  else if (sell.foreign > 0 && state.marketDemand >= TENSION_MAX - 3) {
    score += 2
  }

  // Depot-Abrechnung bei Preisanzeige > 0 → Banktaler.
  for (const f of Object.values(state.fields)) {
    if (!isCommunalDepot(f)) continue
    const meter = f.demand ?? 0
    if (meter > 0 && f.stack.length > 0) {
      score += meter >= TENSION_MAX - 2 ? 12 : 6
    }
  }

  const need = victoryColumnsNeed(state)
  const done = victoryColumnCount(state.players.length) - need
  score += done * 6
  score += playerHarvestScore(state, me) * 4
  score += moneyVictoryScore(state.players[state.currentPlayerIndex]!.money) * 3
  if (need > 0) score += 8
  // Drei volle Stapel → Zugende beendet die Partie.
  if (isPlayerHarvestComplete(state, me)) score += 120

  score += 4
  return score
}

/**
 * Bewertung einer Kartenbewegung für den gierigen Bot.
 * Primärziel: Obst, Beeren, Gemüse und Kräuter in die Erntespalten bringen.
 */
export function scoreMove(state: GameState, cand: MoveCandidate): number {
  const { check, move } = cand
  const card = check.card
  const from = state.fields[move.from]
  const to = state.fields[move.to]
  if (!card || !from || !to) return Number.NEGATIVE_INFINITY
  const player = state.players[state.currentPlayerIndex]!
  const me = player.id
  const count = check.count
  const need = victoryColumnsNeed(state)
  const fromStackIndex = move.stackIndex ?? 0
  const myCrop = ownCropSuit(state)
  let score = 0

  const fromInput =
    (from.kind === 'factory' || isCommunalDepot(from)) &&
    move.lane === 'input'
  const fromFactoryOut =
    hasOutputStack(from) &&
    move.lane !== 'input' &&
    Boolean(factoryProduct(from, fromStackIndex))
  const fromMarket = isMarketField(from)
  const packet = movePacket(state, move, count)
  const packetOwnCrop =
    myCrop != null && packet.every((c) => c.suit === myCrop)

  // Entnahme vom Markt: Standpreis an Ernte-Spieler; Markt→Markt fast nie sinnvoll.
  if (fromMarket) {
    if (isMarketField(to)) {
      return -60 - check.cost * 4
    }
    // Eigene Sorte gratis; fremde Sorte teuer.
    if (packetOwnCrop) score += 12
    else score -= check.cost * 5
  }

  // Endprodukt auf die Erntespalte legen oder zwischen Spalten sortieren.
  if (check.kind === 'claim') {
    const gain = claimCompletionBonus(state, to, packet)
    score += 10 + count * 4 - check.cost * 3
    score += gain
    if (need > 0) score += 12
    if (myCrop && packet.every((c) => c.suit === myCrop)) score += 6

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
    } else if (fromMarket && packetOwnCrop) {
      score += 8
    }

    if (gain >= 90) score += 40

    score += cashReserveMalus(player.money - check.cost)
    return score
  }

  if (check.kind === 'market') {
    // Ablegen: teuersten Stand ≤ Preisanzeige nach +1 wählen.
    const meterAfterRise = Math.min(
      TENSION_MAX,
      Math.max(TENSION_MIN, state.marketDemand + 1),
    )
    const price = to.marketPrice ?? 2
    const ownCrop = packetOwnCrop
    const affordable = marketStallAffordable(price, meterAfterRise)
    const bestPrice =
      ([...MARKET_PRICES].reverse().find((p) =>
        marketStallAffordable(p, meterAfterRise),
      ) ?? 0) as 0 | 2 | 4 | 6

    score += 4 + count * 2 - check.cost * 3
    if (ownCrop) score += 10

    if (affordable && bestPrice > 0) {
      score += 8 + price * (ownCrop ? 5 : 2)
      if (price === bestPrice) score += 18 + meterAfterRise * 2
      else if (price < bestPrice) {
        score -= (bestPrice - price) * 6
        if (bestPrice >= 6 && price === 2) score -= 16
      }
      if (meterAfterRise >= TENSION_MAX - 2) score += 10
    } else if (meterAfterRise === 0) {
      score += price === 2 ? 2 : price === 4 ? -2 : -8
    } else {
      score -= ownCrop ? 6 : 12
      score -= (price - meterAfterRise) * 4
    }

    if (fromFactoryOut) score += 6
    else if (from.kind === 'storage') score += 4
    else if (from.kind === 'victory') score -= 20
    else if (isPersonalGarden(from) && fromFactoryOut) score += 4
    // Nicht die einzige eigene Ernte vom Beet-Ausgang verhökern, wenn VP offen.
    if (need > 0 && ownCrop && fromFactoryOut && isPersonalGarden(from)) {
      score -= 10
    }
    score += cashReserveMalus(player.money - check.cost)
    return score
  }

  if (check.kind === 'feed') {
    score += 8 + card.rank - check.cost * 4
    if (to.owner === me) score += 4

    // Persönliche Beete: Produktion nur bei Wasser+Saat; Rezept schließen belohnen.
    if (isPersonalGarden(to)) {
      const { before, after } = feedFulfillmentDelta(to, packet)
      const delta = after - before
      score += 6 + count * 2
      if (delta > 0) score += 16 + delta * 6
      else if (after === 0) score += 8 // fehlende Zutat nachlegen
      // Wasser vom Regen bevorzugen vor teurem Wasserhandel.
      if (isRegen(from)) score += 8
      else if (isWaterTrade(from) && fromFactoryOut) {
        const meter = from.demand ?? 0
        if (meter > 0) score -= 6
        else score += 4
      }
      score += cashReserveMalus(player.money - check.cost)
      return score
    }

    const { before, after } = feedFulfillmentDelta(to, packet)
    const delta = after - before
    const depot = isCommunalDepot(to)
    const meter = to.demand ?? 0

    if (depot) {
      if (delta > 0) score += 12 + Math.min(10, Math.max(0, meter))
      else score += 2
      // Hohe Preisanzeige stillen → Auszahlung.
      if (meter >= TENSION_MAX - 2) score += 14
      else if (meter > 0) score += 8
      // Saat: Obst vom eigenen Beet/Schuppen; Wasser: vom Regen.
      if (isSeedBed(to) && isCropSuit(card.suit)) score += 4
      if (isWaterTrade(to) && isRegen(from)) score += 10
      if (isWaterTrade(to) && isWaterTrade(from)) score -= 20
    } else if (delta > 0) {
      score += 24 + delta * 8
    } else {
      score += 4
    }

    score += cashReserveMalus(player.money - check.cost)
    return score
  }

  // park / Shift
  score += -14
  if (fromInput) score -= 45
  if (fromMarket) score -= 8

  const relievingSource = isRegen(from) && from.stack.length > 1

  if (fromFactoryOut) {
    score = 14
    // Gratis Depot-Ausgabe (Preis 0) zum Schuppen/Beet ist gut.
    if (isCommunalDepot(from) && (from.demand ?? 0) === 0) score += 6
    if (isCommunalDepot(from) && (from.demand ?? 0) > 0) score -= 8
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

  if (isRegen(to)) {
    score -= 20
  }

  if (to.kind === 'storage' && to.suit && card.suit === to.suit) score += 8
  else if (to.kind === 'storage' && !to.suit) {
    score += 2
  }

  score -= check.cost * 4
  score += cashReserveMalus(player.money - check.cost)
  return score
}

/** @deprecated Käufe entfallen. */
export function scoreBuyInfra(
  _state: GameState,
  _cand: BuyInfraCandidate,
): number {
  return Number.NEGATIVE_INFINITY
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

