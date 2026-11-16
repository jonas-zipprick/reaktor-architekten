import { createGame } from '../state/factory'
import {
  applyAction,
  emptyRecord,
  type GameAction,
  type GameRecord,
} from '../state/recordFormat'
import {
  completedVictoryColumns,
  totalWealth,
  victoryPointCount,
} from '../state/rules'
import { createRng } from '../state/rng'
import type { ScenarioId } from '../types'
import {
  listLegalMoves,
  pickTurnAction,
  planAuction,
  rejectImmediateUndos,
} from './legalMoves'
import type { MoveAction } from '../state/recordFormat'
import type { SimOutcome, SimRunResult } from './types'

/** Max. Kartenbewegungen pro Spielerzug, danach Zugende (Anti-Schleife). */
const MAX_MOVES_PER_TURN = 18

function winnerNameFromText(text: string | null): string {
  if (!text) return ''
  const m = /^Sieg:\s*(.+?)\s+hat\b/.exec(text)
  if (m?.[1]) return m[1]
  return text.replace(/^Sieg:\s*/, '')
}

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
  const status: { outcome: SimOutcome | null } = { outcome: null }
  let movesThisTurn = 0
  /** Auktion wird einmal zu Zugbeginn erwogen (aktuell immer null). */
  let turnPrepared = false
  /** Letzte Kartenbewegung — nächster Zug darf sie nicht 1:1 rückgängig machen. */
  let lastMove: MoveAction | null = null

  const apply = (action: GameAction): boolean => {
    try {
      state = applyAction(state, action)
      record.actions.push(action)
      lastMove = action.type === 'move' ? action : null
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
      const auction = planAuction(state, opts.heuristic, botRng)
      if (auction && !apply(auction)) break
      if (!running()) break
    }

    const moves = rejectImmediateUndos(listLegalMoves(state), lastMove)
    const chosen = pickTurnAction(state, moves, opts.heuristic, botRng, {
      forceEnd: movesThisTurn >= MAX_MOVES_PER_TURN,
    })

    if (chosen.kind === 'endTurn') {
      if (!apply(chosen.action)) break
      movesThisTurn = 0
      turnPrepared = false
      continue
    }

    if (chosen.kind === 'buyInfra' || chosen.kind === 'gift') {
      if (!apply(chosen.action)) break
      continue
    }

    if (!apply(chosen.move)) {
      break
    }
    movesThisTurn += 1
  }

  const finalOutcome: SimOutcome =
    status.outcome ?? (state.ended ? 'finished' : 'aborted')

  const wealth = state.players.map(totalWealth)
  const harvestCards = state.players.reduce(
    (s, p) => s + victoryPointCount(state, p.id),
    0,
  )
  const harvestDone = state.players.reduce(
    (s, p) => s + completedVictoryColumns(state, p.id),
    0,
  )
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  return {
    seed: opts.seed,
    outcome: finalOutcome,
    actions: record.actions.length,
    turns: state.turn,
    winner:
      finalOutcome === 'finished'
        ? winnerNameFromText(state.winnerText)
        : '',
    harvestCards,
    harvestDone,
    wealthMax: wealth.length ? Math.max(...wealth) : 0,
    bankClaims: state.players.reduce((s, p) => s + p.bankClaims, 0),
    bankLeft: state.bank,
    productions: state.stats.productions,
    marketBuys: state.stats.productsDelivered,
    bankIncome: state.stats.marketIncome,
    playerTransfers: state.stats.feesPaidToPlayers,
    bankPaid: state.stats.feesPaidToBank,
    durationMs: Math.round(t1 - t0),
    record,
    winnerText: state.winnerText,
  }
}
