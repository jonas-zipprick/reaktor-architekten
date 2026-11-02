import { create } from 'zustand'
import type { Coord, GameMode, GameState, ScenarioId } from '../types'
import { createGame } from './factory'
import {
  executeMove,
  hoverTarget,
  passTurn,
  removePlanetEnergy,
  selectStack,
  selectVp,
  setToll,
} from './rules'

interface GameStore {
  phase: 'menu' | 'play'
  game: GameState | null
  start: (scenarioId: ScenarioId, mode: GameMode, seed?: number) => void
  backToMenu: () => void
  selectStack: (x: number, y: number, count: number) => void
  selectVp: (x: number, y: number) => void
  clearSelection: () => void
  hover: (to: Coord | null) => void
  moveTo: (to: Coord) => void
  harvestVp: (x: number, y: number, count: number) => void
  setToll: (x: number, y: number, toll: number) => void
  pass: () => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'menu',
  game: null,

  start: (scenarioId, mode, seed) => {
    set({
      phase: 'play',
      game: createGame(scenarioId, mode, seed ?? Date.now()),
    })
  },

  backToMenu: () => set({ phase: 'menu', game: null }),

  selectStack: (x, y, count) => {
    const game = get().game
    if (!game) return
    set({ game: selectStack(game, x, y, count) })
  },

  selectVp: (x, y) => {
    const game = get().game
    if (!game) return
    set({ game: selectVp(game, x, y) })
  },

  clearSelection: () => {
    const game = get().game
    if (!game) return
    set({
      game: {
        ...game,
        selection: null,
        pathPreview: null,
        pathCost: null,
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
    const game = get().game
    if (!game) return
    set({ game: executeMove(game, to) })
  },

  harvestVp: (x, y, count) => {
    const game = get().game
    if (!game) return
    set({ game: removePlanetEnergy(game, x, y, count) })
  },

  setToll: (x, y, toll) => {
    const game = get().game
    if (!game) return
    set({ game: setToll(game, x, y, toll) })
  },

  pass: () => {
    const game = get().game
    if (!game) return
    set({ game: passTurn(game) })
  },
}))
