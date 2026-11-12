import type { ScenarioId } from '../types'
import type { GameRecord } from '../state/recordFormat'

/**
 * finished = Bank leer (reguläres Spielende)
 * stalled  = Stillstand: mehrere Runden lang nur noch Zugenden
 * aborted  = Aktionslimit erreicht
 * stuck    = Bot konnte keine gültige Aktion ausführen
 */
export type SimOutcome = 'finished' | 'stalled' | 'aborted' | 'stuck'

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
   * 1 = greedy: best-scoring card move (delivery income, recipe progress),
   *     otherwise end the turn.
   * In between: with probability h pick greedy, else random.
   */
  heuristic: number
}

export interface SimRunMetrics {
  seed: number
  outcome: SimOutcome
  actions: number
  /** Runde am Ende (steigt, wenn wieder der Startspieler dran ist). */
  turns: number
  /** Name(n) der Spieler mit dem höchsten Gesamtvermögen. */
  leader: string
  /** Höchstes Gesamtvermögen (Bargeld + Bankforderungen). */
  wealthMax: number
  /** Niedrigstes Gesamtvermögen. */
  wealthMin: number
  /** Summe aller Bankforderungen. */
  bankClaims: number
  bankLeft: number
  /** Fertigprodukte, die Fabriken erzeugt haben. */
  productions: number
  /** Produktkarten, die auf Planeten geliefert wurden. */
  productsDelivered: number
  /** Markt-Kollapse (Bedarfsmesser unter −8). */
  marketCollapses: number
  /** Quellen-Kollapse (mehr als 8 Karten). */
  sourceCollapses: number
  /** Durch Befriedigung gespawnte Märkte. */
  marketsSpawned: number
  /** Einkommen aus Markt-Lieferungen. */
  marketIncome: number
  /** Summe Gebühren an andere Spieler. */
  feesPaidToPlayers: number
  /** Summe Gebühren staatlicher Betriebe an die Bank. */
  feesPaidToBank: number
  /** Auktionen mit Zuschlag. */
  auctionsSold: number
  /** Summe aller Zuschlagspreise. */
  auctionVolume: number
  /** Betriebe in Privatbesitz am Ende. */
  privateBusinesses: number
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
