import type { ScenarioId } from '../types'
import type { GameRecord } from '../state/recordFormat'

/**
 * finished = 3 Siegpunkte-Spalten voll (je 6 Karten, 7→2) — Sieg
 * lost     = alle Marktstände weg (Niederlage)
 * stalled  = Stillstand: mehrere Runden lang nur noch Zugenden
 * aborted  = Aktionslimit erreicht
 * stuck    = Bot konnte keine gültige Aktion ausführen
 */
export type SimOutcome = 'finished' | 'lost' | 'stalled' | 'aborted' | 'stuck'

export interface SimConfig {
  scenarioId: ScenarioId
  /** First game seed when starting a fresh run. */
  startSeed: number
  /** Abort a run after this many recorded actions (loop guard). */
  maxActions: number
  /** Worker count; 0 = hardwareConcurrency. */
  workers: number
  /**
   * 0 = uniform random among legal actions (moves, buys, gifts, endTurn).
   * 1 = greedy: best score among moves/buys/gifts/endTurn (projected market
   *     supply, recipe progress, source pressure, chain buys).
   * In between: with probability h pick greedy, else random (endTurn always
   *     in the explore pool).
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
  /** Karten, die am Zugende auf Ausgabestapel gelegt wurden. */
  productions: number
  /** Produktkarten, die auf Marktstände geliefert wurden. */
  productsDelivered: number
  /** Markt-Kollapse (Bedarfsmesser unter −8). */
  marketCollapses: number
  /** @deprecated Quellen kollabieren nicht mehr. */
  sourceCollapses: number
  /** Gekaufte Feldkopien / gespte Märkte. */
  marketsSpawned: number
  /** Einkommen aus Markt-Lieferungen. */
  marketIncome: number
  /** Summe Gebühren an andere Spieler. */
  feesPaidToPlayers: number
  /** Summe Gebühren und Kaufpreise an die Bank. */
  feesPaidToBank: number
  /** Auktionen mit Zuschlag. */
  auctionsSold: number
  /** Summe aller Zuschlagspreise. */
  auctionVolume: number
  /** Betriebe in Privatbesitz am Ende. */
  privateBusinesses: number
  /** Anzahl Käufe (Infrastruktur + Feldkopien) während der Partie. */
  fieldsBought: number
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
