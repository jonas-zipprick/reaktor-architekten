/**
 * Versorgungs-Architekten — Game Record Format
 * ============================================
 *
 * Canonical JSON shape for full games (human play + Monte Carlo imports).
 *
 * ```json
 * {
 *   "format": "va-record",
 *   "version": 22,
 *   "setup": { "scenarioId": "A", "seed": 1234567890 },
 *   "actions": [
 *     { "type": "move", "player": "white", "from": "herz-1", "to": "karo-a" },
 *     { "type": "auction", "player": "white", "at": "pik-1", "winner": "black", "price": 4, "fee": 3 },
 *     { "type": "setFee", "player": "white", "at": "karo-a", "fee": 1 },
 *     { "type": "gift", "player": "white", "to": "black", "amount": 2 },
 *     { "type": "endTurn", "player": "white" }
 *   ]
 * }
 * ```
 *
 * Semantics
 * ---------
 * - `setup.seed` fully determines initial decks, start player, and card IDs
 *   via `createGame(scenarioId, seed)`.
 * - `actions` is a total order of state-changing player decisions after setup.
 * - Position `k` (0 ≤ k ≤ actions.length) = apply the first `k` actions to setup.
 * - Fields are addressed by their scenario id (`herz-1`, `karo-a`, `aurelia`, …).
 * - `move` teleports the top card of `from` onto `to` (source/factory/storage
 *   ↔ factory/storage, or finished product → planet/storage).
 * - `auction` stores the outcome of one open auction: `winner` (or `null` when
 *   nobody bid), the final `price`, and optionally the `fee` the new owner sets
 *   right after the purchase.
 * - `setFee` sets the fee of the player's own business or planet.
 * - `gift` hands cash to another player.
 * - `endTurn` is the shared „Karten ziehen und Produzieren“ action; it ends the turn.
 * - `lagerOffer` resolves the Exp-10 warehouse offer spawned by a prior `endTurn`
 *   (`winner` null = state keeps it at fee 1; otherwise purchase / auction result).
 * - Failed / illegal attempts are NOT recorded.
 * - RNG side effects (start-of-turn Bedarf rolls, reshuffles) are
 *   derived only from the seed + prior actions; do not store dice results separately.
 *
 * Compatibility: bump `version` on breaking changes. Importers should reject
 * unknown `format` or unsupported `version`. Version 3 = rules v8
 * (teleportation, factories, auctions); older records cannot be replayed.
 */

import { fieldLabel, PLAYER_META } from '../data/scenarios'
import type { FieldId, GameState, PlayerId, ScenarioId } from '../types'
import { createGame } from './factory'
import {
  executeAuction,
  executeBuyFieldCopy,
  executeBuyInfra,
  buyableInfraLabel,
  type BuyableInfra,
  executeEndTurn,
  executeGift,
  executeMove,
  resolveLagerOffer,
  setFee,
} from './rules'

export const RECORD_FORMAT = 'va-record' as const
export const RECORD_VERSION = 42 as const

export interface GameRecordSetup {
  scenarioId: ScenarioId
  seed: number
}

export type MoveAction = {
  type: 'move'
  player: PlayerId
  from: FieldId
  to: FieldId
  /** Absteigender Teilstapel von oben; Standard 1. */
  count?: number
  /** Küche/Saatstand: von Eingang statt Ausgabe. */
  lane?: 'input' | 'output'
}

export type SetFeeAction = {
  type: 'setFee'
  player: PlayerId
  at: FieldId
  fee: number
}

export type AuctionAction = {
  type: 'auction'
  /** Player who opened the auction (the active player). */
  player: PlayerId
  at: FieldId
  /** Highest bidder, or null if nobody bid. */
  winner: PlayerId | null
  price: number
  /** Fee the new owner sets immediately after the purchase. */
  fee?: number
}

export type GiftAction = {
  type: 'gift'
  player: PlayerId
  to: PlayerId
  amount: number
}

export type EndTurnAction = {
  type: 'endTurn'
  player: PlayerId
}

export type BuyBeetAction = {
  type: 'buyBeet'
  player: PlayerId
}

export type BuyInfraAction = {
  type: 'buyInfra'
  player: PlayerId
  item: BuyableInfra
}

export type BuyFieldCopyAction = {
  type: 'buyFieldCopy'
  player: PlayerId
  at: FieldId
}

const BUYABLE_INFRA_IDS: BuyableInfra[] = [
  'schuppen',
  'getreidefeld',
  'mehlmuehle',
  'konfituerenkueche',
  'mehlstand',
  'konfituerenstand',
]

function isBuyableInfra(v: unknown): v is BuyableInfra {
  return typeof v === 'string' && (BUYABLE_INFRA_IDS as string[]).includes(v)
}

/** Ergebnis des Exp-10-Angebots (nach endTurn mit pendingLagerOffer). */
export type LagerOfferAction = {
  type: 'lagerOffer'
  player: PlayerId
  at: FieldId
  winner: PlayerId | null
  price: number
  fee?: number
}

export type GameAction =
  | MoveAction
  | SetFeeAction
  | AuctionAction
  | GiftAction
  | EndTurnAction
  | BuyBeetAction
  | BuyInfraAction
  | BuyFieldCopyAction
  | LagerOfferAction

export interface GameRecord {
  format: typeof RECORD_FORMAT
  version: typeof RECORD_VERSION
  setup: GameRecordSetup
  actions: GameAction[]
}

export function emptyRecord(setup: GameRecordSetup): GameRecord {
  return {
    format: RECORD_FORMAT,
    version: RECORD_VERSION,
    setup: { ...setup },
    actions: [],
  }
}

function playerName(id: PlayerId): string {
  return PLAYER_META[id]?.name ?? id
}

export function actionLabel(action: GameAction, scenarioId: ScenarioId): string {
  const who = playerName(action.player)
  const label = (id: FieldId) => fieldLabel(scenarioId, id)
  switch (action.type) {
    case 'move':
      return `${who}: ${label(action.from)} → ${label(action.to)}${
        (action.count ?? 1) > 1 ? ` ×${action.count}` : ''
      }`
    case 'setFee':
      return `${who}: Gebühr ${label(action.at)} = ${action.fee}`
    case 'auction':
      return action.winner
        ? `${who}: Auktion ${label(action.at)} → ${playerName(action.winner)} für ${action.price}¤`
        : `${who}: Auktion ${label(action.at)} ohne Gebot`
    case 'gift':
      return `${who}: schenkt ${playerName(action.to)} ${action.amount}¤`
    case 'endTurn':
      return `${who}: Karten ziehen und Produzieren`
    case 'buyBeet':
      return `${who}: Schuppen gekauft`
    case 'buyInfra':
      return `${who}: ${buyableInfraLabel(action.item)} gekauft`
    case 'buyFieldCopy':
      return `${who}: Kopie von ${label(action.at)} gebaut`
    case 'lagerOffer':
      return action.winner
        ? `${who}: Exp-Lager ${label(action.at)} → ${playerName(action.winner)} für ${action.price}¤`
        : `${who}: Exp-Lager ${label(action.at)} bleibt Staat`
  }
}

export function applyAction(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'move': {
      const next = executeMove(
        state,
        action.from,
        action.to,
        action.count ?? 1,
        action.lane,
      )
      if (next.actionError) {
        throw new Error(`Replay move failed: ${next.actionError}`)
      }
      return next
    }
    case 'setFee':
      return setFee(state, action.at, action.fee)
    case 'auction': {
      const next = executeAuction(
        state,
        action.at,
        action.winner,
        action.price,
        action.fee,
      )
      if (next.actionError) {
        throw new Error(`Replay auction failed: ${next.actionError}`)
      }
      return next
    }
    case 'gift': {
      const next = executeGift(state, action.to, action.amount)
      if (next.actionError) {
        throw new Error(`Replay gift failed: ${next.actionError}`)
      }
      return next
    }
    case 'endTurn':
      return executeEndTurn(state)
    case 'buyBeet': {
      const next = executeBuyInfra(state, 'schuppen')
      if (next.actionError) {
        throw new Error(`Replay buyBeet failed: ${next.actionError}`)
      }
      return next
    }
    case 'buyInfra': {
      const next = executeBuyInfra(state, action.item)
      if (next.actionError) {
        throw new Error(`Replay buyInfra failed: ${next.actionError}`)
      }
      return next
    }
    case 'buyFieldCopy': {
      const next = executeBuyFieldCopy(state, action.at)
      if (next.actionError) {
        throw new Error(`Replay buyFieldCopy failed: ${next.actionError}`)
      }
      return next
    }
    case 'lagerOffer': {
      const next = resolveLagerOffer(
        state,
        action.winner,
        action.price,
        action.fee,
      )
      if (next.actionError) {
        throw new Error(`Replay lagerOffer failed: ${next.actionError}`)
      }
      return next
    }
  }
}

/** State after the first `upTo` actions (0 = initial setup). */
export function replayTo(record: GameRecord, upTo: number): GameState {
  const n = Math.max(0, Math.min(upTo, record.actions.length))
  let state = createGame(record.setup.scenarioId, record.setup.seed)
  for (let i = 0; i < n; i++) {
    state = applyAction(state, record.actions[i]!)
  }
  return state
}

export function serializeRecord(record: GameRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

const PLAYER_IDS: PlayerId[] = ['white', 'black', 'red', 'green']

function isPlayerId(v: unknown): v is PlayerId {
  return typeof v === 'string' && (PLAYER_IDS as string[]).includes(v)
}

function isScenarioId(v: unknown): v is ScenarioId {
  return v === 'A' || v === 'B' || v === 'C' || v === 'D'
}

export function parseRecord(raw: string): GameRecord {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Ungültiges JSON')
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Record muss ein Objekt sein')
  }
  const obj = data as Record<string, unknown>
  if (obj.format !== RECORD_FORMAT) {
    throw new Error(`Unbekanntes Format (erwartet ${RECORD_FORMAT})`)
  }
  if (obj.version !== RECORD_VERSION) {
    throw new Error(
      `Record-Version ${String(obj.version)} wird nicht unterstützt (erwartet ${RECORD_VERSION}, Regeln v8)`,
    )
  }
  const setup = obj.setup as Partial<GameRecordSetup> | undefined
  if (
    !setup ||
    !isScenarioId(setup.scenarioId) ||
    typeof setup.seed !== 'number'
  ) {
    throw new Error('setup unvollständig oder unbekanntes Szenario')
  }
  if (!Array.isArray(obj.actions)) {
    throw new Error('actions fehlt')
  }
  const actions: GameAction[] = []
  for (const [i, a] of obj.actions.entries()) {
    if (!a || typeof a !== 'object') {
      throw new Error(`Aktion ${i} ungültig`)
    }
    const act = a as Record<string, unknown>
    if (!isPlayerId(act.player)) {
      throw new Error(`Aktion ${i}: player ungültig`)
    }
    const player = act.player
    if (act.type === 'move') {
      if (typeof act.from !== 'string' || typeof act.to !== 'string') {
        throw new Error(`move ${i} ungültig`)
      }
      actions.push({
        type: 'move',
        player,
        from: act.from,
        to: act.to,
        ...(typeof act.count === 'number' && act.count > 1
          ? { count: Math.floor(act.count) }
          : {}),
        ...(act.lane === 'input' || act.lane === 'output'
          ? { lane: act.lane }
          : {}),
      })
    } else if (act.type === 'setFee') {
      if (typeof act.at !== 'string' || typeof act.fee !== 'number') {
        throw new Error(`setFee ${i} ungültig`)
      }
      actions.push({ type: 'setFee', player, at: act.at, fee: act.fee })
    } else if (act.type === 'auction') {
      if (
        typeof act.at !== 'string' ||
        typeof act.price !== 'number' ||
        !(act.winner === null || isPlayerId(act.winner))
      ) {
        throw new Error(`auction ${i} ungültig`)
      }
      actions.push({
        type: 'auction',
        player,
        at: act.at,
        winner: act.winner,
        price: act.price,
        ...(typeof act.fee === 'number' ? { fee: act.fee } : {}),
      })
    } else if (act.type === 'gift') {
      if (!isPlayerId(act.to) || typeof act.amount !== 'number') {
        throw new Error(`gift ${i} ungültig`)
      }
      actions.push({ type: 'gift', player, to: act.to, amount: act.amount })
    } else if (act.type === 'endTurn') {
      actions.push({ type: 'endTurn', player })
    } else if (act.type === 'buyBeet') {
      actions.push({ type: 'buyBeet', player })
    } else if (act.type === 'buyInfra') {
      if (!isBuyableInfra(act.item)) {
        throw new Error(`buyInfra ${i} ungültig`)
      }
      actions.push({ type: 'buyInfra', player, item: act.item })
    } else if (act.type === 'buyFieldCopy') {
      if (typeof act.at !== 'string') {
        throw new Error(`buyFieldCopy ${i} ungültig`)
      }
      actions.push({ type: 'buyFieldCopy', player, at: act.at })
    } else if (act.type === 'lagerOffer') {
      if (
        typeof act.at !== 'string' ||
        typeof act.price !== 'number' ||
        !(act.winner === null || isPlayerId(act.winner))
      ) {
        throw new Error(`lagerOffer ${i} ungültig`)
      }
      actions.push({
        type: 'lagerOffer',
        player,
        at: act.at,
        winner: act.winner,
        price: act.price,
        ...(typeof act.fee === 'number' ? { fee: act.fee } : {}),
      })
    } else {
      throw new Error(`Aktion ${i}: unbekannter Typ`)
    }
  }
  return {
    format: RECORD_FORMAT,
    version: RECORD_VERSION,
    setup: {
      scenarioId: setup.scenarioId,
      seed: setup.seed,
    },
    actions,
  }
}
