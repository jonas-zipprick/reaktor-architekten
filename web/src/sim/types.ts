import type { ScenarioId } from '../types'
import type { GameRecord } from '../state/recordFormat'

/**
 * finished = Sieg (drei Erntefelder je Folge 7→2)
 * aborted  = Aktionslimit erreicht
 * stuck    = Bot ohne gültige Aktion
 * stalled  = @deprecated (früher Idle-Abbruch; wird zu aborted normalisiert)
 * lost     = @deprecated (früher Markt-Niederlage; wird zu aborted normalisiert)
 */
export type SimOutcome =
  | 'finished'
  | 'aborted'
  | 'stuck'
  | 'stalled'
  | 'lost'

export interface SimConfig {
  scenarioId: ScenarioId
  /** First game seed when starting a fresh run. */
  startSeed: number
  /** Abort a run after this many recorded actions (loop guard). */
  maxActions: number
  /** Worker count; 0 = hardwareConcurrency. */
  workers: number
  /**
   * 0 = uniform random among legal actions.
   * 1 = greedy best score.
   * In between: with probability h pick greedy, else random.
   */
  heuristic: number
}

/**
 * Kennzahlen einer Monte-Carlo-Partie (aktuelle Garten-Regeln).
 * Alte IDB-Zeilen werden in `normalizeSimMetrics` gemappt.
 */
export interface SimRunMetrics {
  seed: number
  outcome: SimOutcome
  actions: number
  /** Runde am Ende. */
  turns: number
  /** Siegername bei finished, sonst leer. */
  winner: string
  /** Karten auf allen Erntefeldern (Fortschritt). */
  harvestCards: number
  /** Fertige Folgen 7→2 über alle Spieler. */
  harvestDone: number
  /** Höchstes Gesamtvermögen (Bargeld + Forderungen). */
  wealthMax: number
  /** Summe aller Bankforderungen. */
  bankClaims: number
  bankLeft: number
  /** Ausgabekarten erzeugt (Beete / Depot-Nachziehen). */
  productions: number
  /** Marktkarten, die am Zugende aufgekauft wurden. */
  marketBuys: number
  /** Auszahlungen aus der Bank (Depot-Abrechnung, Markt-Zugende). */
  bankIncome: number
  /** Spieler→Spieler (Markt-Entnahme an Ernte-Spieler). */
  playerTransfers: number
  /** Zahlungen an die Bank (z. B. Depot-Ausgabe bei Bedarf &lt; 0). */
  bankPaid: number
  durationMs: number
}

export interface SimRunResult extends SimRunMetrics {
  record: GameRecord
  winnerText: string | null
}

export interface SimProgress {
  /** Completed simulations in the current continuous run (incl. resumes). */
  done: number
  /** Next seed that will be scheduled (or was about to be when paused). */
  nextSeed: number
  running: boolean
  paused: boolean
}

export type WorkerRequest = {
  type: 'run'
  jobId: number
  scenarioId: ScenarioId
  seed: number
  maxActions: number
  heuristic: number
}

export type WorkerResponse =
  | { type: 'result'; jobId: number; result: SimRunResult }
  | { type: 'error'; jobId: number; seed: number; message: string }

/** Alte/teilweise Summaries auf das aktuelle Schema bringen. */
export function normalizeSimMetrics(
  raw: Partial<SimRunMetrics> & Record<string, unknown>,
): SimRunMetrics {
  const outcomeRaw = String(raw.outcome ?? 'aborted')
  const outcome: SimOutcome =
    outcomeRaw === 'finished' ||
    outcomeRaw === 'stalled' ||
    outcomeRaw === 'aborted' ||
    outcomeRaw === 'stuck' ||
    outcomeRaw === 'lost'
      ? outcomeRaw
      : 'aborted'

  const winnerText =
    typeof raw.winnerText === 'string' ? raw.winnerText : null
  const normalizedOutcome: SimOutcome =
    outcome === 'lost' || outcome === 'stalled' ? 'aborted' : outcome
  let winner = typeof raw.winner === 'string' ? raw.winner : ''
  if (normalizedOutcome === 'finished') {
    if (!winner && winnerText) {
      const m = /^Sieg:\s*(.+?)\s+hat\b/.exec(winnerText)
      winner = m?.[1] ?? winnerText.replace(/^Sieg:\s*/, '')
    }
  } else {
    winner = ''
  }

  const num = (v: unknown, fallback = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback

  return {
    seed: num(raw.seed),
    outcome: normalizedOutcome,
    actions: num(raw.actions),
    turns: num(raw.turns),
    winner,
    harvestCards: num(raw.harvestCards),
    harvestDone: num(raw.harvestDone),
    wealthMax: num(raw.wealthMax),
    bankClaims: num(raw.bankClaims),
    bankLeft: num(raw.bankLeft),
    productions: num(raw.productions),
    marketBuys: num(
      raw.marketBuys ?? raw.productsDelivered,
    ),
    bankIncome: num(raw.bankIncome ?? raw.marketIncome),
    playerTransfers: num(
      raw.playerTransfers ?? raw.feesPaidToPlayers,
    ),
    bankPaid: num(raw.bankPaid ?? raw.feesPaidToBank),
    durationMs: num(raw.durationMs),
  }
}
