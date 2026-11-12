import { createGame } from '../state/factory'
import {
  applyAction,
  emptyRecord,
  type GameAction,
  type GameRecord,
} from '../state/recordFormat'
import { leaders, totalWealth } from '../state/rules'
import { createRng } from '../state/rng'
import type { ScenarioId } from '../types'
import {
  listLegalMoves,
  pickTurnAction,
  planAuction,
  planFeeChange,
} from './legalMoves'
import type { SimOutcome, SimRunResult } from './types'

/** Max. Kartenbewegungen pro Spielerzug, danach Zugende (Anti-Schleife). */
const MAX_MOVES_PER_TURN = 12

/**
 * Stillstand: so viele volle Runden hintereinander, in denen jeder Spieler
 * nur seinen Zug beendet hat (keine Bewegung, Auktion oder Gebührenänderung).
 */
const STALL_ROUNDS = 6

export function simulateGame(opts: {
  scenarioId: ScenarioId
  seed: number
  maxActions: number
  heuristic: number
}): SimRunResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  let state = createGame(opts.scenarioId, opts.seed)
  const record: GameRecord = emptyRecord({
    scenarioId: opts.scenarioId,
    seed: opts.seed,
  })

  // Bot RNG separate from table RNG but derived from seed.
  const botRng = createRng((opts.seed ^ 0xa5a5a5a5) >>> 0)
  // Objekt statt let: wird in der apply-Closure gesetzt.
  const status: { outcome: SimOutcome | null } = { outcome: null }
  let movesThisTurn = 0
  /** Gebühren und Auktion werden einmal zu Zugbeginn erwogen. */
  let turnPrepared = false
  /** Aufeinanderfolgende Züge, die nur aus dem Zugende bestanden. */
  let idleTurns = 0
  let actedThisTurn = false
  const stallLimit = STALL_ROUNDS * state.players.length

  const apply = (action: GameAction): boolean => {
    try {
      state = applyAction(state, action)
      record.actions.push(action)
      return true
    } catch {
      status.outcome = 'stuck'
      return false
    }
  }

  const running = () =>
    !status.outcome && !state.ended && record.actions.length < opts.maxActions

  while (running()) {
    if (!turnPrepared) {
      turnPrepared = true
      const fee = planFeeChange(state, opts.heuristic, botRng)
      if (fee && !apply(fee)) break
      if (!running()) break
      const auction = planAuction(state, opts.heuristic, botRng)
      if (auction && !apply(auction)) break
      // Gebührenänderungen allein zählen nicht als Fortschritt.
      if (auction) actedThisTurn = true
      if (!running()) break
    }

    const moves = listLegalMoves(state)
    const chosen = pickTurnAction(state, moves, opts.heuristic, botRng, {
      forceEnd: movesThisTurn >= MAX_MOVES_PER_TURN,
    })

    if (chosen.kind === 'endTurn') {
      if (!apply(chosen.action)) break
      idleTurns = actedThisTurn ? 0 : idleTurns + 1
      actedThisTurn = false
      movesThisTurn = 0
      turnPrepared = false
      if (idleTurns >= stallLimit && !state.ended) {
        status.outcome = 'stalled'
      }
      continue
    }

    if (!apply(chosen.move)) {
      break
    }
    movesThisTurn += 1
    actedThisTurn = true
  }

  const finalOutcome: SimOutcome =
    status.outcome ?? (state.ended ? 'finished' : 'aborted')

  const wealth = state.players.map(totalWealth)
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  return {
    seed: opts.seed,
    outcome: finalOutcome,
    actions: record.actions.length,
    turns: state.turn,
    leader: leaders(state)
      .map((p) => p.name)
      .join(', '),
    wealthMax: Math.max(...wealth),
    wealthMin: Math.min(...wealth),
    bankClaims: state.players.reduce((s, p) => s + p.bankClaims, 0),
    bankLeft: state.bank,
    productions: state.stats.productions,
    productsDelivered: state.stats.productsDelivered,
    marketCollapses: state.stats.marketCollapses,
    sourceCollapses: state.stats.sourceCollapses,
    marketsSpawned: state.stats.marketsSpawned,
    marketIncome: state.stats.marketIncome,
    feesPaidToPlayers: state.stats.feesPaidToPlayers,
    feesPaidToBank: state.stats.feesPaidToBank,
    auctionsSold: state.stats.auctionsSold,
    auctionVolume: state.stats.auctionVolume,
    privateBusinesses: Object.values(state.fields).filter(
      (f) => f.owner && f.owner !== 'state',
    ).length,
    durationMs: Math.round(t1 - t0),
    record,
    winnerText: state.winnerText,
  }
}
