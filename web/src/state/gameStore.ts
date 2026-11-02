import { create } from 'zustand'
import type { Coord, GameMode, GameState, ScenarioId } from '../types'
import { createGame } from './factory'
import {
  executeMove,
  hoverTarget,
  selectStack,
  setToll,
  toggleWaypoint,
} from './rules'

const MAX_HISTORY = 80

function snapshotForHistory(game: GameState): GameState {
  const snap = structuredClone(game)
  snap.selection = null
  snap.waypoints = []
  snap.pathPreview = null
  snap.pathCost = null
  snap.actionError = null
  return snap
}

interface GameStore {
  phase: 'menu' | 'play'
  game: GameState | null
  history: GameState[]
  canUndo: boolean
  start: (scenarioId: ScenarioId, mode: GameMode, seed?: number) => void
  backToMenu: () => void
  selectStack: (x: number, y: number, count: number) => void
  clearSelection: () => void
  hover: (to: Coord | null) => void
  moveTo: (to: Coord) => void
  setWaypoint: (to: Coord) => void
  setToll: (x: number, y: number, toll: number) => void
  undo: () => void
}

function withTurnHistory(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
  apply: (game: GameState) => GameState,
): void {
  const game = get().game
  if (!game || game.ended) return
  const next = apply(game)
  if (next === game) return
  const turned =
    next.turn !== game.turn ||
    next.currentPlayerIndex !== game.currentPlayerIndex ||
    next.ended !== game.ended ||
    next.logSeq !== game.logSeq
  if (!turned) {
    set({ game: next })
    return
  }
  const history = [...get().history, snapshotForHistory(game)].slice(
    -MAX_HISTORY,
  )
  set({ game: next, history, canUndo: history.length > 0 })
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'menu',
  game: null,
  history: [],
  canUndo: false,

  start: (scenarioId, mode, seed) => {
    const autoSeed =
      seed ??
      (typeof crypto !== 'undefined' && 'getRandomValues' in crypto
        ? crypto.getRandomValues(new Uint32Array(1))[0]!
        : Date.now() ^ (Math.random() * 0x100000000))
    set({
      phase: 'play',
      game: createGame(scenarioId, mode, autoSeed),
      history: [],
      canUndo: false,
    })
  },

  backToMenu: () =>
    set({ phase: 'menu', game: null, history: [], canUndo: false }),

  selectStack: (x, y, count) => {
    const game = get().game
    if (!game) return
    set({ game: selectStack(game, x, y, count) })
  },

  clearSelection: () => {
    const game = get().game
    if (!game) return
    set({
      game: {
        ...game,
        selection: null,
        waypoints: [],
        pathPreview: null,
        pathCost: null,
        actionError: null,
      },
    })
  },

  hover: (to) => {
    const game = get().game
    if (!game || !game.selection) return
    if (!to) {
      set({
        game: { ...game, pathPreview: null, pathCost: null },
      })
      return
    }
    set({ game: hoverTarget(game, to) })
  },

  moveTo: (to) => {
    withTurnHistory(get, set, (game) => executeMove(game, to))
  },

  setWaypoint: (to) => {
    const game = get().game
    if (!game) return
    set({ game: toggleWaypoint(game, to) })
  },

  setToll: (x, y, toll) => {
    const game = get().game
    if (!game) return
    set({ game: setToll(game, x, y, toll) })
  },

  undo: () => {
    const { history, game } = get()
    if (!history.length || !game) return
    const prev = history[history.length - 1]
    const nextHistory = history.slice(0, -1)
    set({
      game: structuredClone(prev),
      history: nextHistory,
      canUndo: nextHistory.length > 0,
    })
  },

}))
