import { create } from 'zustand'
import type {
  Card,
  FieldId,
  GameState,
  Owner,
  PlayerId,
  ScenarioId,
} from '../types'
import { parseLocation, syncUrl } from '../routing'
import { createGame } from './factory'
import {
  actionLabel,
  emptyRecord,
  parseRecord,
  replayTo,
  serializeRecord,
  type GameAction,
  type GameRecord,
} from './recordFormat'
import {
  auctionInfo,
  executeAuction,
  executeBuyBeet,
  executeBuyFieldCopy,
  executeBuyInfra,
  type BuyableInfra,
  executeEndTurn,
  executeGift,
  executeMove,
  hasOutputStack,
  selectField,
  setFee,
  type StackLane,
} from './rules'

export type MoveAnim = {
  cards: Card[]
  /** Start- und Zielfeld der Teleportation. */
  path: FieldId[]
  nextGame: GameState
  /** Live play: append action to record after anim. */
  liveAction?: GameAction
  /** Timeline seek: land on this index after anim. */
  seekIndex?: number
}

/** Laufende offene Auktion (reiner UI-Zustand bis zum Zuschlag). */
export type AuctionDraft = {
  fieldId: FieldId
  seller: Owner
  bidders: PlayerId[]
  highBid: number
  highBidder: PlayerId | null
  kind: 'player'
}

function cleanUi(game: GameState): GameState {
  return { ...game, selection: null, actionError: null }
}

function topCards(
  state: GameState,
  fieldId: FieldId,
  count = 1,
  lane?: StackLane,
  stackIndex = 0,
): Card[] {
  const field = state.fields[fieldId]
  if (!field) return []
  let stack: Card[]
  if (field.kind === 'victory') {
    stack = field.stack
  } else if (hasOutputStack(field) && lane !== 'input') {
    stack = field.outputs?.[stackIndex] ?? field.outputs?.[0] ?? []
  } else {
    stack = field.stack
  }
  const n = Math.max(1, Math.min(count, stack.length))
  return stack.slice(stack.length - n)
}

interface GameStore {
  phase: 'menu' | 'play' | 'montecarlo'
  game: GameState | null
  /** Full recorded game (setup + actions). */
  record: GameRecord | null
  /** 0 = setup, k = after first k actions. */
  viewIndex: number
  /** True when viewIndex < actions.length (scrubbing past). */
  isHistoric: boolean
  /** Flying card animation for the last move. */
  moveAnim: MoveAnim | null
  auction: AuctionDraft | null
  start: (
    scenarioId: ScenarioId,
    seed?: number,
    opts?: { replaceUrl?: boolean },
  ) => void
  /** Partie zurücksetzen: gleiches Szenario, neuer Zufalls-Seed. */
  restart: () => void
  importRecord: (raw: string) => void
  exportRecord: () => string | null
  goMonteCarlo: (opts?: { replaceUrl?: boolean }) => void
  backToMenu: (opts?: { replaceUrl?: boolean }) => void
  select: (fieldId: FieldId, lane?: StackLane, stackIndex?: number) => void
  clearSelection: () => void
  moveTo: (to: FieldId, toStackIndex?: number) => void
  finishMoveAnimation: () => void
  setFee: (fieldId: FieldId, fee: number) => void
  gift: (to: PlayerId, amount: number) => void
  /** „Karten ziehen und Produzieren“ — beendet den Zug. */
  endTurn: () => void
  /** Infrastruktur kaufen (Getreidefeld, Mehlmühle, Konfitürenküche). */
  buyInfra: (item: BuyableInfra) => void
  /** Kopie eines Feldes mit positivem Bedarf kaufen. */
  buyFieldCopy: (fieldId: FieldId) => void
  /** @deprecated Schuppenkauf entfällt. */
  buyBeet: () => void
  openAuction: (fieldId: FieldId) => void
  /** Gebot abgeben; muss das Höchstgebot um mindestens 1 übertreffen. */
  placeBid: (player: PlayerId, amount: number) => void
  /** Zuschlag an den Höchstbietenden (oder Ende ohne Gebot). */
  closeAuction: (fee?: number) => void
  /** Jump to position after `index` actions (0…actions.length). */
  seek: (index: number) => void
  undo: () => void
}

function appendAction(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
  action: GameAction,
  nextGame: GameState,
): void {
  const record = get().record
  if (!record) return
  const viewIndex = get().viewIndex
  const truncated: GameRecord = {
    ...record,
    actions: [...record.actions.slice(0, viewIndex), action],
  }
  const nextIndex = truncated.actions.length
  set({
    record: truncated,
    viewIndex: nextIndex,
    isHistoric: false,
    game: cleanUi(nextGame),
  })
}

const RESET = {
  game: null,
  record: null,
  viewIndex: 0,
  isHistoric: false,
  moveAnim: null,
  auction: null,
} as const

export const useGameStore = create<GameStore>((set, get) => {
  /** Kein Eingriff, solange Animation oder Auktion laufen. */
  const idleGame = (): GameState | null => {
    const { game, moveAnim, auction } = get()
    if (!game || game.ended || moveAnim || auction) return null
    return game
  }

  return {
    phase: 'menu',
    ...RESET,

    start: (scenarioId, seed, opts) => {
      const autoSeed =
        seed ??
        (typeof crypto !== 'undefined' && 'getRandomValues' in crypto
          ? crypto.getRandomValues(new Uint32Array(1))[0]!
          : Date.now() ^ (Math.random() * 0x100000000))
      const game = createGame(scenarioId, autoSeed)
      const record = emptyRecord({ scenarioId, seed: autoSeed })
      set({ ...RESET, phase: 'play', game, record })
      syncUrl(
        { page: 'play', scenarioId, seed: autoSeed },
        opts?.replaceUrl ? 'replace' : 'push',
      )
    },

    restart: () => {
      const scenarioId =
        get().game?.scenarioId ?? get().record?.setup.scenarioId
      if (!scenarioId) return
      get().start(scenarioId, undefined, { replaceUrl: true })
    },

    importRecord: (raw) => {
      const record = parseRecord(raw)
      const game = replayTo(record, record.actions.length)
      set({
        ...RESET,
        phase: 'play',
        game: cleanUi(game),
        record,
        viewIndex: record.actions.length,
      })
      syncUrl({
        page: 'play',
        scenarioId: record.setup.scenarioId,
        seed: record.setup.seed,
      })
    },

    exportRecord: () => {
      const record = get().record
      if (!record) return null
      return serializeRecord(record)
    },

    goMonteCarlo: (opts) => {
      set({ ...RESET, phase: 'montecarlo' })
      syncUrl({ page: 'montecarlo' }, opts?.replaceUrl ? 'replace' : 'push')
    },

    backToMenu: (opts) => {
      set({ ...RESET, phase: 'menu' })
      syncUrl({ page: 'menu' }, opts?.replaceUrl ? 'replace' : 'push')
    },

    select: (fieldId, lane, stackIndex) => {
      const game = idleGame()
      if (!game) return
      set({ game: selectField(game, fieldId, lane, stackIndex ?? 0) })
    },

    clearSelection: () => {
      const game = get().game
      if (!game || get().moveAnim) return
      set({ game: cleanUi(game) })
    },

    moveTo: (to, toStackIndex) => {
      const game = idleGame()
      if (!game || !game.selection) return
      const from = game.selection.fieldId
      const count = game.selection.count
      const lane = game.selection.lane
      const stackIndex = game.selection.stackIndex ?? 0
      const toIdx = toStackIndex ?? 0
      const player = game.players[game.currentPlayerIndex]!.id
      const next = executeMove(game, from, to, count, lane, {
        stackIndex,
        toStackIndex: toIdx,
      })
      if (next.actionError) {
        set({ game: next })
        return
      }
      const action: GameAction = {
        type: 'move',
        player,
        from,
        to,
        ...(count > 1 ? { count } : {}),
        ...(lane === 'input' ? { lane } : {}),
        ...(stackIndex > 0 ? { stackIndex } : {}),
        ...(toIdx > 0 ? { toStackIndex: toIdx } : {}),
      }

      // Brett bleibt im Vor-Zug-Zustand; nach der Fluganimation committen.
      set({
        moveAnim: {
          cards: topCards(game, from, count, lane, stackIndex),
          path: [from, to],
          nextGame: next,
          liveAction: action,
        },
        game: cleanUi(game),
      })
    },

    finishMoveAnimation: () => {
      const anim = get().moveAnim
      if (!anim) return
      set({ moveAnim: null })
      if (anim.liveAction) {
        appendAction(get, set, anim.liveAction, anim.nextGame)
        return
      }
      const record = get().record
      const seekIndex = anim.seekIndex ?? get().viewIndex
      set({
        game: cleanUi(anim.nextGame),
        viewIndex: seekIndex,
        isHistoric: record ? seekIndex < record.actions.length : false,
      })
    },

    setFee: (fieldId, fee) => {
      const game = idleGame()
      if (!game) return
      const field = game.fields[fieldId]
      const nextFee = Math.max(0, Math.floor(fee))
      if (!field || field.fee === nextFee) return
      const player = game.players[game.currentPlayerIndex]!.id
      if (field.owner !== player) return
      const next = setFee(game, fieldId, nextFee)
      if (next.actionError) {
        set({ game: next })
        return
      }
      appendAction(
        get,
        set,
        { type: 'setFee', player, at: fieldId, fee: nextFee },
        next,
      )
    },

    gift: (to, amount) => {
      const game = idleGame()
      if (!game) return
      const player = game.players[game.currentPlayerIndex]!.id
      const next = executeGift(game, to, amount)
      if (next.actionError) {
        set({ game: next })
        return
      }
      appendAction(get, set, { type: 'gift', player, to, amount }, next)
    },

    endTurn: () => {
      const game = idleGame()
      if (!game) return
      const player = game.players[game.currentPlayerIndex]!.id
      const next = executeEndTurn(game)
      appendAction(get, set, { type: 'endTurn', player }, next)
    },

    buyInfra: (item) => {
      const game = idleGame()
      if (!game) return
      const player = game.players[game.currentPlayerIndex]!.id
      const next = executeBuyInfra(game, item)
      if (next.actionError) {
        set({ game: next })
        return
      }
      appendAction(get, set, { type: 'buyInfra', player, item }, next)
    },
    buyFieldCopy: (fieldId) => {
      const game = idleGame()
      if (!game) return
      const player = game.players[game.currentPlayerIndex]!.id
      const next = executeBuyFieldCopy(game, fieldId)
      if (next.actionError) {
        set({ game: next })
        return
      }
      appendAction(get, set, { type: 'buyFieldCopy', player, at: fieldId }, next)
    },
    buyBeet: () => {
      const game = idleGame()
      if (!game) return
      set({ game: executeBuyBeet(game) })
    },

    openAuction: (fieldId) => {
      const game = idleGame()
      if (!game) return
      const info = auctionInfo(game, fieldId)
      if (!info.ok || !info.seller) {
        set({
          game: {
            ...game,
            actionError: info.reason ?? 'Auktion nicht möglich',
          },
        })
        return
      }
      set({
        game: cleanUi(game),
        auction: {
          fieldId,
          seller: info.seller,
          bidders: info.bidders,
          highBid: 0,
          highBidder: null,
          kind: 'player',
        },
      })
    },

    placeBid: (player, amount) => {
      const { game, auction } = get()
      if (!game || !auction) return
      const bidder = game.players.find((p) => p.id === player)
      if (!bidder || !auction.bidders.includes(player)) return
      const bid = Math.floor(amount)
      // Startgebot 1¤, jedes weitere Gebot mindestens 1¤ höher, nur Bargeld.
      if (bid < auction.highBid + 1 || bid > bidder.money) return
      set({ auction: { ...auction, highBid: bid, highBidder: player } })
    },

    closeAuction: (fee) => {
      const { game, auction } = get()
      if (!game || !auction) return
      const player = game.players[game.currentPlayerIndex]!.id
      const next = executeAuction(
        game,
        auction.fieldId,
        auction.highBidder,
        auction.highBid,
        auction.highBidder ? fee : undefined,
      )
      set({ auction: null })
      if (next.actionError) {
        set({ game: next })
        return
      }
      appendAction(
        get,
        set,
        {
          type: 'auction',
          player,
          at: auction.fieldId,
          winner: auction.highBidder,
          price: auction.highBid,
          ...(auction.highBidder && fee != null
            ? { fee: Math.max(0, Math.floor(fee)) }
            : {}),
        },
        next,
      )
    },

    seek: (index) => {
      const record = get().record
      if (!record || get().moveAnim || get().auction) return
      const clamped = Math.max(0, Math.min(index, record.actions.length))
      const fromIndex = get().viewIndex
      if (clamped === fromIndex) return

      // Ein Schritt vor: Kartenbewegung animieren
      if (clamped === fromIndex + 1) {
        const action = record.actions[fromIndex]
        if (action?.type === 'move') {
          const before = cleanUi(replayTo(record, fromIndex))
          const count = action.count ?? 1
          set({
            moveAnim: {
              cards: topCards(before, action.from, count, action.lane),
              path: [action.from, action.to],
              nextGame: replayTo(record, clamped),
              seekIndex: clamped,
            },
            game: before,
            // viewIndex bleibt bis Anim-Ende
          })
          return
        }
      }

      // Ein Schritt zurück: Kartenbewegung rückwärts animieren
      if (clamped === fromIndex - 1 && fromIndex > 0) {
        const action = record.actions[fromIndex - 1]
        if (action?.type === 'move') {
          const before = cleanUi(replayTo(record, clamped))
          const after = cleanUi(replayTo(record, fromIndex))
          const count = action.count ?? 1
          set({
            moveAnim: {
              cards: topCards(before, action.from, count, action.lane),
              path: [action.to, action.from],
              nextGame: before,
              seekIndex: clamped,
            },
            game: after,
          })
          return
        }
      }

      // Sprung über mehrere Schritte / andere Aktionen: sofort
      const game = cleanUi(replayTo(record, clamped))
      set({
        game,
        viewIndex: clamped,
        isHistoric: clamped < record.actions.length,
        moveAnim: null,
      })
    },

    undo: () => {
      if (get().moveAnim || get().auction) return
      const { viewIndex } = get()
      if (viewIndex <= 0) return
      get().seek(viewIndex - 1)
    },
  }
})

export { actionLabel }

/**
 * URL → Store. Beim ersten Laden und bei Browser zurück/vor.
 * Nutzt replaceUrl, damit popstate keine Extra-History-Einträge erzeugt.
 */
export function applyRouteFromLocation(): void {
  const route = parseLocation()
  const store = useGameStore.getState()

  if (route.page === 'menu') {
    store.backToMenu({ replaceUrl: true })
    return
  }

  if (route.page === 'montecarlo') {
    store.goMonteCarlo({ replaceUrl: true })
    return
  }

  const current = store.record?.setup
  if (
    store.phase === 'play' &&
    store.game &&
    current?.scenarioId === route.scenarioId &&
    (route.seed == null || route.seed === current.seed)
  ) {
    syncUrl(
      {
        page: 'play',
        scenarioId: current.scenarioId,
        seed: current.seed,
      },
      'replace',
    )
    return
  }

  store.start(route.scenarioId, route.seed, { replaceUrl: true })
}
