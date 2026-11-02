import { getScenario, PLAYER_META, playersFor } from '../data/scenarios'
import type {
  Card,
  CellState,
  GameMode,
  GameState,
  PlayerState,
  Rank,
  ScenarioId,
} from '../types'
import { keyOf } from '../types'
import { createRng, shuffle } from './rng'

let cardSeq = 0
function makeCard(
  suit: Card['suit'],
  rank: Rank,
  faceUp = false,
): Card {
  cardSeq += 1
  return { id: `c${cardSeq}`, suit, rank, faceUp }
}

/** Energiekarten pro Sonne: 2×5, 4×4, 6×3, 8×2, 10×Ass. */
function sunEnergyDeck(rng: () => number): Card[] {
  const counts: [Rank, number][] = [
    [5, 2],
    [4, 4],
    [3, 6],
    [2, 8],
    [1, 10],
  ]
  const cards: Card[] = []
  for (const [rank, n] of counts) {
    for (let i = 0; i < n; i++) cards.push(makeCard('hearts', rank, false))
  }
  return shuffle(cards, rng)
}

function emptyCell(x: number, y: number): CellState {
  return {
    x,
    y,
    kind: 'empty',
    stack: [],
    drawPile: [],
    discardPile: [],
    toll: 0,
    tension: 0,
  }
}

function moneySetup(playerCount: number): { start: number; bank: number } {
  const total = playerCount * 60
  const startEach = 12
  return { start: startEach, bank: total - startEach * playerCount }
}

export function createGame(
  scenarioId: ScenarioId,
  mode: GameMode,
  seed = Date.now(),
): GameState {
  cardSeq = 0
  const rng = createRng(seed)
  const scenario = getScenario(scenarioId)
  if (!scenario.modes.includes(mode)) {
    throw new Error(`Mode ${mode} not supported by scenario ${scenarioId}`)
  }

  const playerIds = playersFor(scenarioId, mode)
  const money = moneySetup(playerIds.length)

  const cells: Record<string, CellState> = {}

  if (scenario.bounds) {
    const { minX, maxX, minY, maxY } = scenario.bounds
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells[keyOf(x, y)] = emptyCell(x, y)
      }
    }
  }

  for (const f of scenario.cells) {
    const existing = cells[keyOf(f.x, f.y)]
    cells[keyOf(f.x, f.y)] = {
      x: f.x,
      y: f.y,
      kind: f.kind,
      label: f.label,
      owner: f.owner,
      stack: existing?.stack ?? [],
      drawPile: existing?.drawPile ?? [],
      discardPile: existing?.discardPile ?? [],
      toll: 0,
      tension: 0,
    }
  }

  // Basen und Speicher entfallen — als leere Felder behandeln.
  for (const c of Object.values(cells)) {
    if (c.kind === 'base' || c.kind === 'storage') {
      c.kind = 'empty'
      c.owner = undefined
      c.label = undefined
      c.stack = []
      c.drawPile = []
      c.discardPile = []
      c.toll = 0
    }
  }

  for (const c of Object.values(cells)) {
    if (c.kind === 'sun') {
      const deck = sunEnergyDeck(rng)
      const top = deck.pop()!
      top.faceUp = true
      c.stack = [top]
      c.drawPile = deck
    }
  }

  for (const p of Object.values(cells)) {
    if (p.kind !== 'planet') continue
    p.stack = []
    p.tension = -2
  }

  const defs =
    mode === 'solo'
      ? scenario.defenses.solo
      : mode === 'coop'
        ? scenario.defenses.coop
        : scenario.defenses.versus

  for (const d of defs) {
    const cell = cells[keyOf(d.x, d.y)]
    if (!cell) continue
    const card = makeCard('spades', d.rank, true)
    cell.stack = [card]
    cell.owner = 'neutral'
    cell.toll = d.toll
    cell.kind = 'empty'
  }

  const players: PlayerState[] = playerIds.map((id) => ({
    id,
    name: PLAYER_META[id].name,
    money: money.start,
    bankClaims: 0,
    securedVp: 0,
    color: PLAYER_META[id].color,
  }))

  const missionSpec =
    mode === 'solo'
      ? scenario.missions.solo
      : mode === 'coop'
        ? scenario.missions.coop
        : null

  return {
    scenarioId,
    mode,
    cells,
    players,
    currentPlayerIndex: 0,
    bank: money.bank,
    energyReserve: [],
    energyDiscard: [],
    missions: missionSpec
      ? {
          suppliedPlanets: [],
          defensesDefeated: 0,
          requiredPlanets: missionSpec.planets,
          requiredDefenses: missionSpec.defenses,
        }
      : null,
    selection: null,
    waypoints: [],
    pathPreview: null,
    pathCost: null,
    actionError: null,
    demandRollSeq: 0,
    demandRollFlash: null,
    planetLimitSeq: 0,
    planetLimitFlash: null,
    log: [
      {
        id: 1,
        text: `${scenario.name} · ${modeLabel(mode)} gestartet. ${players[0].name} beginnt.`,
        tone: 'info',
      },
    ],
    logSeq: 1,
    turn: 1,
    ended: false,
    winnerText: null,
    rngSeed: seed,
  }
}

function modeLabel(mode: GameMode): string {
  switch (mode) {
    case 'solo':
      return 'Solo'
    case 'coop':
      return 'Koop'
    case 'versus':
      return 'Versus'
  }
}

/**
 * Oberkarte der Sonne nachziehen. Ist der Nachziehstapel leer, wird die
 * gemeinsame Ablage gemischt und als neuer Nachziehstapel verwendet.
 */
export function refillSun(cell: CellState, state: GameState, rng: () => number): void {
  if (cell.stack.length > 0) return

  if (cell.drawPile.length === 0 && state.energyDiscard.length > 0) {
    const n = state.energyDiscard.length
    cell.drawPile = shuffle(
      state.energyDiscard.map((c) => ({ ...c, faceUp: false })),
      rng,
    )
    state.energyDiscard = []
    state.logSeq += 1
    state.log.unshift({
      id: state.logSeq,
      text: `Sonne (${cell.x},${cell.y}): Ablage (${n}) neu gemischt.`,
      tone: 'info',
    })
    if (state.log.length > 80) state.log.length = 80
  }

  const next = cell.drawPile.pop()
  if (next) {
    next.faceUp = true
    cell.stack = [next]
  } else {
    cell.stack = []
  }
}

export function revealTopIfNeeded(cell: CellState): void {
  if (cell.stack.length > 0) {
    const top = cell.stack[cell.stack.length - 1]
    if (!top.faceUp) top.faceUp = true
    return
  }
  if (cell.drawPile.length > 0) {
    const next = cell.drawPile.pop()!
    next.faceUp = true
    cell.stack = [next]
  }
}
