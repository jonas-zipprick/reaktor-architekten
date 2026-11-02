import { getScenario, PLAYER_META, playersFor } from '../data/scenarios'
import type {
  Card,
  CellState,
  GameMode,
  GameState,
  PlayerId,
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

function energyDeck(rng: () => number): Card[] {
  const ranks: Rank[] = [5, 4, 3, 2, 1]
  const cards: Card[] = []
  // Several copies so suns feel unerschöpflich
  for (let copy = 0; copy < 4; copy++) {
    for (const r of ranks) cards.push(makeCard('hearts', r, false))
  }
  return shuffle(cards, rng)
}

function demandDeck(planetCount: number, rng: () => number): Card[] {
  // ~10 Kreuzkarten pro Planet (Playtestempfehlung)
  const ranks: Rank[] = [6, 5, 4, 3]
  const cards: Card[] = []
  const total = Math.max(10, planetCount * 10)
  for (let i = 0; i < total; i++) {
    cards.push(makeCard('clubs', ranks[i % ranks.length], false))
  }
  return shuffle(cards, rng)
}

function unitDeck(rng: () => number): Card[] {
  const cards = [
    makeCard('diamonds', 1, false),
    makeCard('diamonds', 3, false),
    makeCard('spades', 2, false),
    makeCard('spades', 4, false),
  ]
  return shuffle(cards, rng)
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

  // Fill rectangular bounds with empty cells if defined
  if (scenario.bounds) {
    const { minX, maxX, minY, maxY } = scenario.bounds
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells[keyOf(x, y)] = {
          x,
          y,
          kind: 'empty',
          stack: [],
          drawPile: [],
          toll: 0,
          vpMarkers: 0,
        }
      }
    }
  }

  // Place scenario cells (overwrite empties / create U-shape cells)
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
      toll: 0,
      vpMarkers: 0,
    }
  }

  // Remove bases not used in this mode
  for (const key of Object.keys(cells)) {
    const c = cells[key]
    if (c.kind === 'base' && c.owner && !playerIds.includes(c.owner as PlayerId)) {
      c.kind = 'empty'
      c.owner = undefined
      c.label = undefined
    }
  }

  // Suns: energy draw piles
  for (const c of Object.values(cells)) {
    if (c.kind === 'sun') {
      const deck = energyDeck(rng)
      const top = deck.pop()!
      top.faceUp = true
      c.stack = [top]
      c.drawPile = deck
    }
  }

  // Bases: unit decks
  for (const c of Object.values(cells)) {
    if (c.kind === 'base' && c.owner) {
      const deck = unitDeck(rng)
      const top = deck.pop()!
      top.faceUp = true
      c.stack = [top]
      c.drawPile = deck
    }
  }

  const planets = Object.values(cells).filter((c) => c.kind === 'planet')
  let demands = demandDeck(planets.length, rng)
  for (const p of planets) {
    const d = demands.pop()
    if (d) {
      d.faceUp = true
      p.stack = [d]
    }
  }

  // Neutral defenses
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

  const energyReserve = energyDeck(rng)

  return {
    scenarioId,
    mode,
    cells,
    players,
    currentPlayerIndex: 0,
    bank: money.bank,
    demandDeck: demands,
    energyReserve,
    energyDiscard: [],
    demandDiscard: [],
    missions: missionSpec
      ? {
          suppliedPlanets: [],
          defensesDefeated: 0,
          requiredPlanets: missionSpec.planets,
          requiredDefenses: missionSpec.defenses,
        }
      : null,
    selection: null,
    pathPreview: null,
    pathCost: null,
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

export function refillSun(cell: CellState, state: GameState, rng: () => number): void {
  if (cell.drawPile.length === 0) {
    // Unerschöpflich: neuen Stapel aus Reserve/Discard
    let pool = [...state.energyReserve, ...state.energyDiscard]
    state.energyDiscard = []
    if (pool.length < 5) {
      const ranks: Rank[] = [5, 4, 3, 2, 1]
      for (const r of ranks) {
        for (let i = 0; i < 2; i++) pool.push(makeCard('hearts', r, false))
      }
    }
    pool = shuffle(pool, rng)
    cell.drawPile = pool
    state.energyReserve = []
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
  if (cell.stack.length === 0 && cell.drawPile.length > 0) {
    const next = cell.drawPile.pop()!
    next.faceUp = true
    cell.stack = [next]
  } else if (cell.stack.length > 0) {
    const top = cell.stack[cell.stack.length - 1]
    if (!top.faceUp) top.faceUp = true
  }
}
