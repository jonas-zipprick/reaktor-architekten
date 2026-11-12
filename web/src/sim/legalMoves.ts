import type { FieldState, GameState, PlayerId } from '../types'
import {
  hasOwnership,
  matchesRecipe,
  recipeFulfillments,
  SUITS,
} from '../types'
import type {
  AuctionAction,
  EndTurnAction,
  MoveAction,
  SetFeeAction,
} from '../state/recordFormat'
import {
  canStillComplete,
  checkMove,
  factoryHasOutput,
  factoryProduct,
  maxRunFromTop,
  movableCard,
  type MoveCheck,
} from '../state/rules'

/**
 * Bargeld, das Bots zurückhalten: Abholgebühr (2¤) + Eigentumsmarker (2¤),
 * sonst bleibt ein fertiges Produkt unbezahlbar liegen.
 */
const CASH_RESERVE = 4

/** Legal card move with fees and planet income already computed. */
export type MoveCandidate = {
  kind: 'move'
  move: MoveAction
  check: MoveCheck
}

export type EndTurnCandidate = {
  kind: 'endTurn'
  action: EndTurnAction
}

export type TurnCandidate = MoveCandidate | EndTurnCandidate

/** All affordable legal card moves of the active player. */
export function listLegalMoves(state: GameState): MoveCandidate[] {
  if (state.ended) return []
  const player = state.players[state.currentPlayerIndex]!.id
  const out: MoveCandidate[] = []
  const ids = Object.keys(state.fields)

  for (const from of ids) {
    if (!movableCard(state, from)) continue
    const max = maxRunFromTop(state.fields[from]!.stack)
    for (let count = 1; count <= max; count++) {
      for (const to of ids) {
        if (to === from) continue
        const check = checkMove(state, from, to, count)
        if (!check.ok) continue
        out.push({
          kind: 'move',
          move: {
            type: 'move',
            player,
            from,
            to,
            ...(count > 1 ? { count } : {}),
          },
          check,
        })
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

function isBlocked(field: FieldState): boolean {
  return (
    field.stack.length > 0 &&
    Boolean(field.recipe) &&
    !canStillComplete(field.stack, field.recipe!)
  )
}

/**
 * Bewertung einer Kartenbewegung für den gierigen Bot. > 0 = lohnt sich.
 *
 * Lieferung: Netto-Einkommen am passenden Bedarfsmesser, kein Kollaps.
 * Rohstoffe: Fortschritt Richtung erfülltem Rezept.
 */
export function scoreMove(state: GameState, cand: MoveCandidate): number {
  const { check, move } = cand
  const card = check.card
  const from = state.fields[move.from]
  const to = state.fields[move.to]
  if (!card || !from || !to) return Number.NEGATIVE_INFINITY
  const player = state.players[state.currentPlayerIndex]!

  if (check.kind === 'deliver') {
    // Abholen macht die Fabrik wieder frei für die nächste Produktion.
    let score = 6 - check.cost * 4
    // Eigene Märkte sind gebührenfrei und halten den Betrieb.
    if (to.owner === player.id) score += 12

    score += (check.income - check.cost) * 6 + card.rank
    // Überlieferung (Messer schon 0) bringt kein Geld — lohnt nur zum Freiräumen.
    // Zusätzlich riskiert anhaltende Befriedigung einen neuen Markt-Spawn.
    if (check.income === 0) score -= 22
    return score
  }

  if (check.kind === 'park' || to.kind === 'storage') {
    // Ablage: Produkt freiräumen, blockierte Fabrik retten; nicht sinnlos zudecken.
    let score = -12
    if (from.kind === 'factory' && factoryHasOutput(from) && !factoryProduct(from))
      score = 40
    else if (from.kind === 'factory' && factoryProduct(from)) score = 38
    else if (from.kind === 'factory' && isBlocked(from)) score = 22
    else if (from.kind === 'source' && from.stack.length > 1) score = 5
    else if (from.kind === 'storage') score = -40
    if (to.kind === 'factory' && factoryHasOutput(to)) score -= 25
    if (check.cost > 0 && player.money - check.cost < CASH_RESERVE) return -100
    return score - check.cost * 5
  }

  // Rohstoff auf eine Fabrik (von Quelle, anderer Fabrik oder Lager).
  const recipe = to.recipe
  if (!recipe) return Number.NEGATIVE_INFINITY
  let score: number

  {
    const after = [...to.stack, card]
    if (!canStillComplete(after, recipe)) {
      score = -45
    } else if (matchesRecipe(after, recipe)) {
      // Je voller Erfüllung eine Produktkarte am Zugende.
      const batches = recipeFulfillments(after, recipe)
      score = 50 + batches * 18 + (to.owner === player.id ? 15 : 0)
    } else {
      // Noch fehlende Karten laut Rezept; Spielraum in der Rangfolge.
      let missing = 0
      for (const suit of SUITS) {
        const need = recipe[suit] ?? 0
        const got = after.filter((c) => c.suit === suit).length
        missing += Math.max(0, need - got)
      }
      const slack = card.rank - missing - 1
      // Angefangene Stapel fortsetzen ist mehr wert als neue zu beginnen.
      score = after.length === 1 ? 8 + slack : 14 + after.length * 6 + slack
    }
  }

  if (check.kind === 'shift') {
    // Umlegen nur, um eine Karte aus einem verbauten Stapel zu retten.
    score = isBlocked(from) || from.kind === 'storage' ? score - 6 : -100
  }

  // Rohstoffe bringen selbst kein Geld: Reserve für Abholgebühr halten.
  if (check.cost > 0 && player.money - check.cost < CASH_RESERVE) return -100

  // Größere absteigende Teilstapel leicht bevorzugen.
  return score - check.cost * 5 + (check.count - 1) * 3
}

/**
 * Zugwahl: beste Kartenbewegung, sonst „Karten ziehen und Produzieren“.
 */
export function pickTurnAction(
  state: GameState,
  moves: MoveCandidate[],
  heuristic: number,
  rng: () => number,
  opts: { forceEnd?: boolean } = {},
): TurnCandidate {
  const end = endTurnCandidate(state)
  if (opts.forceEnd || !moves.length) return end

  const h = Math.max(0, Math.min(1, heuristic))

  // Zufällig: unter den Bewegungen + Zugende
  if (h <= 0) {
    const pool: TurnCandidate[] = [...moves, end]
    return pool[Math.floor(rng() * pool.length)]!
  }

  const useGreedy = h >= 1 || rng() < h
  if (!useGreedy) {
    const pool: TurnCandidate[] = [...moves]
    if (rng() < 0.25) pool.push(end)
    return pool[Math.floor(rng() * pool.length)]!
  }

  const scored = moves.map((c) => ({ c, score: scoreMove(state, c) }))
  const best = Math.max(...scored.map((s) => s.score))
  // Kein klarer Nutzen → Zug beenden.
  if (best <= 0) return end
  const top = scored.filter((s) => s.score === best)
  return top[Math.floor(rng() * top.length)]!.c
}

/** Fehlt dem Spieler noch ein eigenes Lager? */
function needsBusiness(
  state: GameState,
  playerId: PlayerId,
  field: FieldState,
): boolean {
  if (!hasOwnership(field.kind)) return false
  return !Object.values(state.fields).some(
    (f) => f.owner === playerId && f.kind === 'storage',
  )
}

/** Höchstgebot eines Bots für einen Betrieb (0 = bietet nicht mit). */
function maxBid(
  state: GameState,
  playerId: PlayerId,
  field: FieldState,
  heuristic: number,
  rng: () => number,
): number {
  const money = state.players.find((p) => p.id === playerId)!.money
  const needed = needsBusiness(state, playerId, field)
  // Mit Heuristik: fehlende Betriebe sind mehr wert; ohne: beliebig 1–5.
  const wish =
    heuristic <= 0
      ? 1 + rng() * 4
      : needed
        ? 2 + rng() * (2 + 3 * heuristic)
        : 1 + rng() * 2
  return Math.max(0, Math.min(money - CASH_RESERVE, Math.round(wish)))
}

/**
 * Höchstens eine Auktion pro Zug: meist Privatisierung eines staatlichen
 * Betriebs (bevorzugt einer, der dem Spieler noch fehlt); bei Geldnot Verkauf
 * eines eigenen Betriebs.
 * Ergebnis der offenen Auktion: Höchstbietender zahlt Zweitgebot + 1.
 */
export function planAuction(
  state: GameState,
  heuristic: number,
  rng: () => number,
): AuctionAction | null {
  if (state.ended || state.auctionUsed || state.players.length === 1) return null
  const h = Math.max(0, Math.min(1, heuristic))
  const player = state.players[state.currentPlayerIndex]!
  const storages = Object.values(state.fields).filter((f) =>
    hasOwnership(f.kind),
  )

  let pool: FieldState[]
  let bidders: PlayerId[]
  const own = storages.filter((f) => f.owner === player.id)
  if (player.money < CASH_RESERVE && own.length > 1 && rng() < 0.5) {
    // Geldnot: eigenes Lager an die Mitspieler verkaufen.
    pool = own
    bidders = state.players.filter((p) => p.id !== player.id).map((p) => p.id)
  } else {
    const stateOwned = storages.filter((f) => f.owner === 'state')
    const needed = stateOwned.filter((f) => needsBusiness(state, player.id, f))
    const targeted = needed.length > 0 && rng() < h
    pool = targeted ? needed : stateOwned
    bidders = state.players.map((p) => p.id)
    const chance = targeted ? 0.35 + 0.6 * h : 0.15 + 0.2 * h
    if (rng() > chance) return null
  }
  if (!pool.length) return null

  const field = pool[Math.floor(rng() * pool.length)]!
  const bids = bidders
    .map((id) => ({
      id,
      max: maxBid(state, id, field, h, rng),
      tie: rng(),
    }))
    .filter((b) => b.max >= 1)
    .sort((a, b) => b.max - a.max || a.tie - b.tie)
  // Niemand würde bieten → Bot eröffnet gar nicht erst.
  if (!bids.length) return null

  const winner = bids[0]!
  const price = bids[1] ? Math.min(winner.max, bids[1].max + 1) : 1
  return {
    type: 'auction',
    player: player.id,
    at: field.id,
    winner: winner.id,
    price,
    fee: 1 + Math.floor(rng() * 3),
  }
}

/** Freie Aktion: Gebühr eines eigenen Lagers anpassen. */
export function planFeeChange(
  state: GameState,
  heuristic: number,
  rng: () => number,
): SetFeeAction | null {
  if (state.players.length === 1) return null
  const player = state.players[state.currentPlayerIndex]!
  const own = Object.values(state.fields).filter(
    (f) => hasOwnership(f.kind) && f.owner === player.id,
  )
  if (!own.length) return null

  const h = Math.max(0, Math.min(1, heuristic))
  if (rng() > 0.25 + 0.25 * h) return null

  const field = own[Math.floor(rng() * own.length)]!
  // 0 selten; 1–4 üblich; bei Heuristik eher 1–3.
  let fee: number
  if (h <= 0) {
    const roll = rng()
    fee = roll < 0.15 ? 0 : roll < 0.4 ? 1 : roll < 0.7 ? 2 : roll < 0.9 ? 3 : 4
  } else {
    const base = 1 + Math.floor(rng() * 3) // 1–3
    fee = rng() < 0.12 * (1 - h) ? 0 : base + (rng() < 0.2 * h ? 1 : 0)
  }
  if (fee === field.fee) return null

  return { type: 'setFee', player: player.id, at: field.id, fee }
}
