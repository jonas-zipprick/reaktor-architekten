import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  allBoardHexes,
  BANK_START,
  buildLandscapeDeck,
  CRITICAL_LIMIT,
  SHIP_SPAWNS,
} from '../data/boardLayout'
import { FIELD_DEFS } from '../data/fields'
import { METER_LABELS, METER_SHORT, playerLabel } from '../data/labels'
import { shufflePlanetNames } from '../data/planetNames'
import {
  hexDistance,
  hexEquals,
  hexKey,
  neighbor,
} from '../hex/math'
import type {
  Axial,
  CellState,
  Chip,
  ChipColor,
  ChipResource,
  ConsumerUnit,
  DirIndex,
  FieldKind,
  LandscapeTerrain,
  MeterKind,
  PhaseId,
  PlayerId,
  PlayerState,
  ToolMode,
  Winner,
} from '../types'

const PHASES: { id: PhaseId; label: string; hint: string }[] = [
  {
    id: 'order',
    label: 'Rundenstart',
    hint: 'Reihenfolgechip nach Geld, dann Bedarf würfeln, dann jede aufgedeckte Quelle emittiert.',
  },
  {
    id: 'navigate',
    label: 'Schiff',
    hint: 'Raumschiff bewegen oder stehen lassen. Nachbarn erkunden. Auf einer Quelle den Richtungspfeil drehen.',
  },
  {
    id: 'build',
    label: 'Bauen',
    hint: 'Leere Felder bebauen, Trafo nachladen. Verbraucher auf eigenem/neutralem Planeten.',
  },
  {
    id: 'simulate',
    label: 'Simulation',
    hint: 'Chips entlang der Quellenpfeile. Fog: weiterfliegen. Wand/Asteroid → Beutel. Uran/Licht auf Planeten: weg.',
  },
  {
    id: 'end',
    label: 'Abschluss',
    hint: `Kritisch bei ±${CRITICAL_LIMIT}: Kolonie weg, Messer auf 0. Geldstapel leer → Spielende.`,
  },
]

export { PHASES }

const STORAGE_KEY = 'reaktor-playtest-v10'
const START_MONEY = 4
const MAX_HISTORY = 80

const CHIP_ENERGY: Record<ChipColor, number> = {
  blue: 1,
  purple: 2,
  red: 3,
}

const SOURCE_RESOURCE: Record<string, ChipResource> = {
  uranium: 'uranium',
  sun: 'light',
  water: 'water',
}

const METER_KINDS: MeterKind[] = ['voltage', 'water', 'heat']
const SOURCE_TERRAINS = new Set(['uranium', 'sun', 'water'])

let idSeq = 0
function uid(prefix: string): string {
  idSeq += 1
  return `${prefix}-${idSeq}`
}

function syncIdSeq(chips: Chip[], cells: Record<string, CellState>) {
  let max = 0
  for (const c of chips) {
    const m = /-(\d+)$/.exec(c.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  for (const cell of Object.values(cells)) {
    for (const cons of cell.consumers) {
      const m = /-(\d+)$/.exec(cons.id)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  idSeq = max
}

function randomColor(): ChipColor {
  const bag: ChipColor[] = ['blue', 'purple', 'red']
  return bag[Math.floor(Math.random() * bag.length)]
}

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1
}

/** Consumer die faces: −3, −2, −1, +1 (usually demand, sometimes self-supply). */
const W4_FACES = [-3, -2, -1, 1] as const

function rollW4(): number {
  return W4_FACES[Math.floor(Math.random() * W4_FACES.length)]
}

function formatMeterDelta(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`
}

function nextClockwise(p: PlayerId): PlayerId {
  return p === 1 ? 2 : 1
}

function playerScore(p: PlayerState): number {
  return p.money + (p.owed ?? 0)
}

function assignOrderChip(
  players: Record<PlayerId, PlayerState>,
  current: PlayerId,
): PlayerId {
  const ids: PlayerId[] = [1, 2]
  const min = Math.min(...ids.map((id) => players[id].money))
  const tied = ids.filter((id) => players[id].money === min)
  if (tied.length === 1) return tied[0]
  let p = nextClockwise(current)
  for (let i = 0; i < ids.length; i++) {
    if (tied.includes(p)) return p
    p = nextClockwise(p)
  }
  return current
}

function payToBank(
  players: Record<PlayerId, PlayerState>,
  bank: number,
  p: PlayerId,
  cost: number,
): { players: Record<PlayerId, PlayerState>; bank: number } | null {
  if (players[p].money < cost) return null
  return {
    players: {
      ...players,
      [p]: { ...players[p], money: players[p].money - cost },
    },
    bank: bank + cost,
  }
}

function earnFromBank(
  players: Record<PlayerId, PlayerState>,
  bank: number,
  p: PlayerId,
  amount: number,
): { players: Record<PlayerId, PlayerState>; bank: number; owedNote: string } {
  const take = Math.min(bank, amount)
  const extra = amount - take
  return {
    bank: bank - take,
    players: {
      ...players,
      [p]: {
        ...players[p],
        money: players[p].money + take,
        owed: (players[p].owed ?? 0) + extra,
      },
    },
    owedNote:
      extra > 0
        ? ` · Bank leer, ${playerLabel(p)} +${take} bar / +${extra} gutgeschrieben`
        : '',
  }
}

function emptyCell(hex: Axial): CellState {
  return {
    hex,
    revealed: false,
    terrain: 'empty',
    voltage: 0,
    water: 0,
    heat: 0,
    consumers: [],
    sourceStock: [],
  }
}

const LANDSCAPE_LABELS: Record<LandscapeTerrain, string> = {
  empty: 'Leer',
  uranium: 'Uranquelle',
  sun: 'Sonnenquelle',
  water: 'Wasserquelle',
  mountain: 'Asteroid',
  planet: 'Planet',
}

function makeCells(): Record<string, CellState> {
  const cells: Record<string, CellState> = {}
  for (const hex of allBoardHexes()) {
    cells[hexKey(hex)] = emptyCell(hex)
  }
  // Ship start hexes are discovered (empty space, no landscape tile)
  for (const spawn of Object.values(SHIP_SPAWNS)) {
    const key = hexKey(spawn)
    cells[key] = { ...cells[key], revealed: true, terrain: 'empty' }
  }
  return cells
}

/**
 * Reveal all unrevealed neighbors of a ship hex by drawing from the landscape deck.
 * Planets get a unique name from planetNames.
 */
function revealAroundShip(
  cells: Record<string, CellState>,
  deck: LandscapeTerrain[],
  planetNames: string[],
  shipHex: Axial,
): {
  cells: Record<string, CellState>
  deck: LandscapeTerrain[]
  planetNames: string[]
  revealed: string[]
} {
  let nextCells = cells
  let nextDeck = deck
  let nextNames = planetNames
  const revealed: string[] = []

  for (let d = 1; d <= 6; d++) {
    const hex = neighbor(shipHex, d as DirIndex)
    const key = hexKey(hex)
    const cell = nextCells[key]
    if (!cell || cell.revealed) continue
    if (nextDeck.length === 0) break

    const [tile, ...rest] = nextDeck
    nextDeck = rest
    if (nextCells === cells) nextCells = { ...cells }

    let planetName: string | undefined
    if (tile === 'planet') {
      if (nextNames.length > 0) {
        planetName = nextNames[0]
        nextNames = nextNames.slice(1)
      } else {
        planetName = `Planet-${hex.q},${hex.r}`
      }
    }

    const sourceDir = SOURCE_TERRAINS.has(tile)
      ? (rollDie() as DirIndex)
      : undefined
    nextCells[key] = {
      ...cell,
      revealed: true,
      terrain: tile,
      planetName,
      voltage: 0,
      water: 0,
      heat: 0,
      consumers: [],
      planetOwner: undefined,
      sourceStock: [],
      sourceDir,
    }
    const label =
      tile === 'planet' && planetName
        ? `${planetName}`
        : SOURCE_TERRAINS.has(tile)
          ? `${LANDSCAPE_LABELS[tile]} Pfeil ${sourceDir}`
          : `${LANDSCAPE_LABELS[tile]} (${hex.q},${hex.r})`
    revealed.push(label)
  }

  return {
    cells: nextCells,
    deck: nextDeck,
    planetNames: nextNames,
    revealed,
  }
}

function setupBoard(rng: () => number = Math.random): {
  cells: Record<string, CellState>
  landscapeDeck: LandscapeTerrain[]
  planetNames: string[]
  logLines: string[]
} {
  let cells = makeCells()
  let landscapeDeck = buildLandscapeDeck(rng)
  let planetNames = shufflePlanetNames(rng)
  const logLines: string[] = []

  for (const p of [1, 2] as PlayerId[]) {
    const result = revealAroundShip(
      cells,
      landscapeDeck,
      planetNames,
      SHIP_SPAWNS[p],
    )
    cells = result.cells
    landscapeDeck = result.deck
    planetNames = result.planetNames
    if (result.revealed.length > 0) {
      logLines.push(
        `${playerLabel(p)} Start-Erkundung: ${result.revealed.join(' · ')}`,
      )
    }
  }

  return { cells, landscapeDeck, planetNames, logLines }
}

function seedSourceCharges(
  cells: Record<string, CellState>,
): Record<string, CellState> {
  const next = { ...cells }
  for (const [key, cell] of Object.entries(cells)) {
    if (!cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) continue
    next[key] = {
      ...cell,
      sourceStock: [...cell.sourceStock, randomColor()],
    }
  }
  return next
}

function emitRevealedSources(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): { cells: Record<string, CellState>; log: string[] } {
  const count = Object.values(cells).filter(
    (c) => c.revealed && SOURCE_TERRAINS.has(c.terrain),
  ).length
  return {
    cells: seedSourceCharges(cells),
    log: appendLog(
      log,
      day,
      `Emit: ${count} Quelle(n) erhalten je 1 zufälligen Chip.`,
    ),
  }
}

function meterCritical(cell: CellState): boolean {
  return METER_KINDS.some(
    (m) => cell[m] <= -CRITICAL_LIMIT || cell[m] >= CRITICAL_LIMIT,
  )
}

function applyColonyDestruction(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): { cells: Record<string, CellState>; log: string[] } {
  let nextCells = cells
  let nextLog = log
  for (const [key, cell] of Object.entries(cells)) {
    if (cell.terrain !== 'planet' || cell.consumers.length === 0) continue
    if (!meterCritical(cell)) continue
    if (nextCells === cells) nextCells = { ...cells }
    const n = cell.consumers.length
    const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
    nextCells[key] = {
      ...cell,
      consumers: [],
      planetOwner: undefined,
      voltage: 0,
      water: 0,
      heat: 0,
    }
    nextLog = appendLog(
      nextLog,
      day,
      `${name}: Kolonie zerstört (${n} Verbraucher, Messer ±${CRITICAL_LIMIT}) — neutral, Messer auf 0.`,
    )
  }
  return { cells: nextCells, log: nextLog }
}

function decideWinner(players: Record<PlayerId, PlayerState>): Winner {
  const m1 = playerScore(players[1])
  const m2 = playerScore(players[2])
  if (m1 > m2) return 1
  if (m2 > m1) return 2
  return 'draw'
}

function shipOnHex(
  ships: Record<PlayerId, Axial>,
  hex: Axial,
): PlayerId | null {
  if (hexEquals(ships[1], hex)) return 1
  if (hexEquals(ships[2], hex)) return 2
  return null
}

export type Snapshot = {
  day: number
  phase: PhaseId
  activePlayer: PlayerId
  players: Record<PlayerId, PlayerState>
  cells: Record<string, CellState>
  chips: Chip[]
  ships: Record<PlayerId, Axial>
  landscapeDeck: LandscapeTerrain[]
  /** Remaining unique planet names for newly revealed planets */
  planetNames: string[]
  /** Who already moved their ship this navigate phase */
  shipMoved: Record<PlayerId, boolean>
  /** Remaining money in the shared pile */
  bank: number
  /** Player who starts each alternating phase */
  orderHolder: PlayerId
  selectedHex: Axial | null
  selectedChipId: string | null
  /** Select-tool: raumschiff aufgenommen (Objekt → Ziel) */
  heldShip: PlayerId | null
  tool: ToolMode
  placeKind: FieldKind
  approveType: MeterKind | null
  lastDice: DirIndex | null
  log: string[]
  lost: boolean
  lossReason: string | null
  gameOver: boolean
  winner: Winner | null
}

export interface GameState extends Snapshot {
  past: Snapshot[]

  reset: () => void
  undo: () => void
  setTool: (tool: ToolMode) => void
  setPlaceKind: (kind: FieldKind) => void
  setApproveType: (type: MeterKind) => void
  selectHex: (hex: Axial | null) => void
  selectChip: (id: string | null) => void
  setPhase: (phase: PhaseId) => void
  nextPhase: () => void
  setActivePlayer: (p: PlayerId) => void
  adjustMoney: (p: PlayerId, delta: number) => void
  rollDemand: () => void
  approveConsumer: (hex: Axial, type: MeterKind) => void
  /** Select-tool: Objekt aufnehmen / ablegen (Chip oder Schiff). */
  selectAt: (hex: Axial) => void
  /** Select-tool: Schiff explizit aufnehmen (Klick auf Schiff-Marker). */
  pickShip: (player: PlayerId) => void
  moveShip: (hex: Axial, player?: PlayerId) => void
  exploreHex: (hex: Axial) => void
  skipShipMove: () => void
  seedSourcesForEmit: () => void
  adjustMeter: (hex: Axial, meter: MeterKind, delta: number) => void
  rollDice: () => DirIndex
  drawFromBag: () => ChipColor
  placeField: (hex: Axial, kind: FieldKind, owner: PlayerId) => void
  removeField: (hex: Axial) => void
  /** Remove-tool: Chip / Feld / Verbraucher / Ladung auf Hex entfernen. */
  removeAt: (hex: Axial) => void
  addStockChip: (hex: Axial, color: ChipColor, bound: boolean) => void
  removeStockAt: (hex: Axial, bound: boolean) => void
  releaseCharge: (hex: Axial, count: number) => void
  spawnFlying: (
    hex: Axial,
    color: ChipColor,
    dir: DirIndex,
    resource?: ChipResource,
  ) => void
  moveChipAt: (hex: Axial) => void
  stepChip: (chipId: string) => void
  setChipDir: (chipId: string, dir: DirIndex) => void
  setChipResource: (chipId: string, resource: ChipResource) => void
  landChip: (chipId: string, as: 'bound' | 'free') => void
  removeChip: (chipId: string) => void
  applyChipToPlanet: (chipId: string) => void
  emitFromSource: (hex: Axial, dir?: DirIndex) => void
  setSourceDir: (hex: Axial, dir: DirIndex) => void
  setTerrain: (hex: Axial, terrain: CellState['terrain']) => void
  newDay: () => void
  checkCritical: () => void
  pushLog: (msg: string) => void
}

function toolForPhase(phase: PhaseId): ToolMode | undefined {
  if (phase === 'build') return 'place'
  if (phase === 'navigate' || phase === 'simulate') return 'select'
  return 'select'
}

function takeSnapshot(s: Snapshot): Snapshot {
  return {
    day: s.day,
    phase: s.phase,
    activePlayer: s.activePlayer,
    players: s.players,
    cells: s.cells,
    chips: s.chips,
    ships: s.ships,
    landscapeDeck: s.landscapeDeck,
    planetNames: s.planetNames,
    shipMoved: s.shipMoved,
    bank: s.bank,
    orderHolder: s.orderHolder,
    selectedHex: s.selectedHex,
    selectedChipId: s.selectedChipId,
    heldShip: s.heldShip,
    tool: s.tool,
    placeKind: s.placeKind,
    approveType: s.approveType,
    lastDice: s.lastDice,
    log: s.log,
    lost: s.lost,
    lossReason: s.lossReason,
    gameOver: s.gameOver,
    winner: s.winner,
  }
}

function initialData(): Snapshot {
  idSeq = 0
  const board = setupBoard()
  const setupLog = [
    `Neues Spiel — Bank ${BANK_START - START_MONEY * 2}, Reihenfolgechip bei ${playerLabel(1)}.`,
    ...board.logLines.map((line) => `T1: ${line}`),
  ]
  const demand = runDemandRoll(board.cells, 1, setupLog)
  const emitted = emitRevealedSources(demand.cells, 1, demand.log)
  return {
    day: 1,
    phase: 'order',
    activePlayer: 1,
    players: {
      1: { money: START_MONEY, owed: 0 },
      2: { money: START_MONEY, owed: 0 },
    },
    cells: emitted.cells,
    chips: [],
    ships: {
      1: { ...SHIP_SPAWNS[1] },
      2: { ...SHIP_SPAWNS[2] },
    },
    landscapeDeck: board.landscapeDeck,
    planetNames: board.planetNames,
    shipMoved: { 1: false, 2: false },
    bank: BANK_START - START_MONEY * 2,
    orderHolder: 1,
    selectedHex: null,
    selectedChipId: null,
    heldShip: null,
    tool: 'select',
    placeKind: 'divert',
    approveType: null,
    lastDice: null,
    log: emitted.log.slice(0, 80),
    lost: false,
    lossReason: null,
    gameOver: false,
    winner: null,
  }
}

function normalizePhase(phase: string): PhaseId {
  if (phase === 'demand') return 'build'
  if (phase === 'emit') return 'simulate'
  if (
    phase === 'order' ||
    phase === 'navigate' ||
    phase === 'build' ||
    phase === 'simulate' ||
    phase === 'end'
  ) {
    return phase
  }
  return 'order'
}

function appendLog(log: string[], day: number, msg: string): string[] {
  return [`T${day}: ${msg}`, ...log].slice(0, 80)
}

/** Approve consumers: own hex (player marker / planet owner) or ship present. */
function canActOnOwnedOrShip(
  cells: Record<string, CellState>,
  ships: Record<PlayerId, Axial>,
  player: PlayerId,
  hex: Axial,
): boolean {
  if (hexEquals(ships[player], hex)) return true
  const cell = cells[hexKey(hex)]
  if (!cell) return false
  if (cell.field?.owner === player) return true
  if (cell.terrain === 'planet' && cell.planetOwner === player) return true
  return false
}

function runDemandRoll(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): { cells: Record<string, CellState>; log: string[] } {
  let nextCells = { ...cells }
  let nextLog = log
  const parts: string[] = []

  for (const [key, cell] of Object.entries(cells)) {
    if (
      !cell.revealed ||
      cell.terrain !== 'planet' ||
      cell.consumers.length === 0
    ) {
      continue
    }
    let voltage = cell.voltage
    let water = cell.water
    let heat = cell.heat
    for (const cons of cell.consumers) {
      const roll = rollW4()
      if (cons.type === 'voltage') voltage += roll
      else if (cons.type === 'water') water += roll
      else heat += roll
      const planet = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
      parts.push(`${planet} ${METER_LABELS[cons.type]} ${formatMeterDelta(roll)}`)
    }
    nextCells[key] = { ...cell, voltage, water, heat }
  }

  if (parts.length === 0) {
    nextLog = appendLog(
      nextLog,
      day,
      'Bedarf: keine Verbraucher — nichts gewürfelt.',
    )
  } else {
    nextLog = appendLog(nextLog, day, `Bedarf: ${parts.join(' · ')}`)
  }

  return { cells: nextCells, log: nextLog }
}

function applyPhaseEntry(
  s: Snapshot,
  phase: PhaseId,
  day: number,
  log: string[],
): Partial<Snapshot> {
  let cells = s.cells
  let shipMoved = s.shipMoved
  let orderHolder = s.orderHolder
  let activePlayer = s.activePlayer
  let gameOver = s.gameOver
  let winner = s.winner
  let nextLog = log

  if (phase === 'order') {
    orderHolder = assignOrderChip(s.players, s.orderHolder)
    activePlayer = orderHolder
    nextLog = appendLog(
      nextLog,
      day,
      `Reihenfolgechip: ${playerLabel(orderHolder)} beginnt.`,
    )
    const rolled = runDemandRoll(cells, day, nextLog)
    cells = rolled.cells
    nextLog = rolled.log
    const emitted = emitRevealedSources(cells, day, nextLog)
    cells = emitted.cells
    nextLog = emitted.log
  }

  if (phase === 'navigate') {
    shipMoved = { 1: false, 2: false }
    activePlayer = s.orderHolder
  }

  if (phase === 'build' || phase === 'simulate') {
    activePlayer = s.orderHolder
  }

  if (phase === 'end') {
    const destroyed = applyColonyDestruction(cells, day, nextLog)
    cells = destroyed.cells
    nextLog = destroyed.log
    if (s.bank <= 0) {
      gameOver = true
      winner = decideWinner(s.players)
      const reason =
        winner === 'draw'
          ? 'Geldstapel leer — Gleichstand, Gewinn als Team.'
          : `Geldstapel leer — ${playerLabel(winner)} gewinnt.`
      nextLog = appendLog(nextLog, day, reason)
    }
  }

  return {
    cells,
    log: nextLog,
    shipMoved,
    orderHolder,
    activePlayer,
    gameOver,
    winner,
  }
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => {
      const setUi = set

      const commit = (
        patchFn: (s: GameState) => Partial<Snapshot> | null,
      ) => {
        set((s) => {
          const patch = patchFn(s)
          if (!patch) return s
          return {
            past: [...s.past, takeSnapshot(s)].slice(-MAX_HISTORY),
            ...patch,
          }
        })
      }

      return {
        ...initialData(),
        past: [],

        reset: () => set({ ...initialData(), past: [] }),

        undo: () => {
          const { past } = get()
          if (past.length === 0) return
          const prev = past[past.length - 1]
          set({
            ...prev,
            past: past.slice(0, -1),
          })
          syncIdSeq(prev.chips, prev.cells)
        },

        setTool: (tool) =>
          setUi({
            tool,
            heldShip: null,
            selectedChipId: tool === 'select' ? get().selectedChipId : null,
            approveType: tool === 'place' ? get().approveType : null,
          }),
        setPlaceKind: (placeKind) =>
          setUi({
            placeKind,
            approveType: null,
            tool: 'place',
            heldShip: null,
            selectedChipId: null,
          }),
        setApproveType: (approveType) =>
          setUi({
            approveType,
            tool: 'place',
            heldShip: null,
            selectedChipId: null,
          }),
        selectHex: (selectedHex) => setUi({ selectedHex }),
        selectChip: (selectedChipId) =>
          setUi({ selectedChipId, heldShip: null }),

        setPhase: (phase) => {
          commit((s) => {
            if (s.phase === phase || s.gameOver) return null
            const entered = applyPhaseEntry(s, phase, s.day, s.log)
            const tool = toolForPhase(phase)
            return {
              phase,
              ...entered,
              heldShip: null,
              selectedChipId: phase === 'simulate' ? s.selectedChipId : null,
              ...(tool ? { tool } : {}),
            }
          })
        },

        nextPhase: () => {
          commit((s) => {
            if (s.gameOver) return null
            const i = PHASES.findIndex((p) => p.id === s.phase)
            const next = PHASES[(i + 1) % PHASES.length]
            let day = s.day
            let log = appendLog(s.log, s.day, `Phase → ${next.label}`)

            if (next.id === 'order' && s.phase === 'end') {
              day = s.day + 1
              log = appendLog(log, day, `Tag ${day} beginnt.`)
            }

            const entered = applyPhaseEntry({ ...s, day }, next.id, day, log)
            const tool = toolForPhase(next.id)
            return {
              phase: next.id,
              day,
              ...entered,
              heldShip: null,
              selectedChipId: next.id === 'simulate' ? null : s.selectedChipId,
              ...(tool ? { tool } : {}),
            }
          })
        },

        setActivePlayer: (activePlayer) => commit(() => ({ activePlayer })),

        adjustMoney: (p, delta) =>
          commit((s) => {
            if (delta === 0) return null
            if (delta > 0) {
              const earned = earnFromBank(s.players, s.bank, p, delta)
              return {
                players: earned.players,
                bank: earned.bank,
              }
            }
            const cost = Math.min(-delta, s.players[p].money)
            if (cost === 0) return null
            const paid = payToBank(s.players, s.bank, p, cost)
            if (!paid) return null
            return { players: paid.players, bank: paid.bank }
          }),

        rollDemand: () => {
          commit((s) => {
            const rolled = runDemandRoll(s.cells, s.day, s.log)
            return { cells: rolled.cells, log: rolled.log }
          })
        },

        selectAt: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null

            // Drop held ship
            if (s.heldShip != null) {
              const p = s.heldShip
              const from = s.ships[p]
              if (hexEquals(from, hex)) {
                return {
                  heldShip: null,
                  selectedHex: hex,
                  log: appendLog(
                    s.log,
                    s.day,
                    `Schiff ${playerLabel(p)} abgelegt.`,
                  ),
                }
              }
              if (!cell.revealed) {
                return {
                  log: appendLog(
                    s.log,
                    s.day,
                    'Unentdecktes Feld — nicht begehbar.',
                  ),
                }
              }
              const other: PlayerId = p === 1 ? 2 : 1
              if (hexEquals(s.ships[other], hex)) {
                return {
                  log: appendLog(
                    s.log,
                    s.day,
                    'Feld vom anderen Raumschiff besetzt.',
                  ),
                }
              }
              const around = revealAroundShip(
                s.cells,
                s.landscapeDeck,
                s.planetNames,
                hex,
              )
              let log = appendLog(
                s.log,
                s.day,
                `${playerLabel(p)} fliegt nach (${hex.q},${hex.r}).`,
              )
              if (around.revealed.length > 0) {
                log = appendLog(
                  log,
                  s.day,
                  `Auto-Erkundung: ${around.revealed.join(' · ')}`,
                )
              }
              if (SOURCE_TERRAINS.has(cell.terrain)) {
                const dir =
                  around.cells[key]?.sourceDir ?? cell.sourceDir
                log = appendLog(
                  log,
                  s.day,
                  `Auf Quelle — Pfeil ${dir ?? '?'} darf gedreht werden.`,
                )
              }
              return {
                ships: { ...s.ships, [p]: { ...hex } },
                cells: around.cells,
                landscapeDeck: around.deck,
                planetNames: around.planetNames,
                shipMoved: { ...s.shipMoved, [p]: true },
                heldShip: null,
                selectedChipId: null,
                selectedHex: hex,
                activePlayer: other,
                log: appendLog(log, s.day, `→ ${playerLabel(other)}`),
              }
            }

            // Drop / pick chip via shared logic — inline pick/drop
            const held = s.selectedChipId
              ? s.chips.find((c) => c.id === s.selectedChipId)
              : undefined

            if (held && (held.state === 'free' || held.state === 'flying')) {
              if (hexEquals(held.hex, hex)) {
                return {
                  selectedChipId: null,
                  selectedHex: hex,
                  log: appendLog(s.log, s.day, 'Chip-Auswahl aufgehoben.'),
                }
              }
              return {
                chips: s.chips.map((c) =>
                  c.id === held.id ? { ...c, hex: { ...hex } } : c,
                ),
                selectedHex: hex,
                selectedChipId: null,
                heldShip: null,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${held.color} → (${hex.q},${hex.r}).`,
                ),
              }
            }

            // Prefer chips/charges over ships so both can be selected on one hex.
            // Ships are picked via pickShip (click on the ship marker).
            const flyingHere = [...s.chips]
              .reverse()
              .find((c) => c.state === 'flying' && hexEquals(c.hex, hex))
            if (flyingHere) {
              return {
                selectedChipId: flyingHere.id,
                heldShip: null,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${flyingHere.color} aufgenommen. Zielhex klicken.`,
                ),
              }
            }
            const freeHere = [...s.chips]
              .reverse()
              .find((c) => c.state === 'free' && hexEquals(c.hex, hex))
            if (freeHere) {
              return {
                selectedChipId: freeHere.id,
                heldShip: null,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${freeHere.color} aufgenommen. Zielhex klicken.`,
                ),
              }
            }
            if (cell.field && cell.field.charge.length > 0) {
              const color = cell.field.charge[cell.field.charge.length - 1]
              const chip: Chip = {
                id: uid('chip'),
                color,
                state: 'free',
                hex: { ...hex },
              }
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    field: {
                      ...cell.field,
                      charge: cell.field.charge.slice(0, -1),
                    },
                  },
                },
                chips: [...s.chips, chip],
                selectedChipId: chip.id,
                heldShip: null,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Ladung ${color} aufgenommen. Zielhex klicken.`,
                ),
              }
            }
            if (cell.sourceStock.length > 0) {
              const color = cell.sourceStock[cell.sourceStock.length - 1]
              const resource = SOURCE_RESOURCE[cell.terrain]
              const chip: Chip = {
                id: uid('chip'),
                color,
                state: 'free',
                hex: { ...hex },
                resource,
              }
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    sourceStock: cell.sourceStock.slice(0, -1),
                  },
                },
                chips: [...s.chips, chip],
                selectedChipId: chip.id,
                heldShip: null,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Ladung ${color} aufgenommen. Zielhex klicken.`,
                ),
              }
            }

            const shipHere = shipOnHex(s.ships, hex)
            if (shipHere != null) {
              return {
                heldShip: shipHere,
                selectedChipId: null,
                selectedHex: hex,
                activePlayer: shipHere,
                log: appendLog(
                  s.log,
                  s.day,
                  `Schiff ${playerLabel(shipHere)} aufgenommen. Zielhex klicken.`,
                ),
              }
            }

            return {
              selectedHex: hex,
              log: appendLog(
                s.log,
                s.day,
                `Nichts zum Aufnehmen auf (${hex.q},${hex.r}).`,
              ),
            }
          })
        },

        pickShip: (player) => {
          commit((s) => {
            const hex = s.ships[player]
            return {
              heldShip: player,
              selectedChipId: null,
              selectedHex: { ...hex },
              activePlayer: player,
              log: appendLog(
                s.log,
                s.day,
                `Schiff ${playerLabel(player)} aufgenommen. Zielhex klicken.`,
              ),
            }
          })
        },

        moveShip: (hex, player) => {
          commit((s) => {
            const p = player ?? s.activePlayer
            const from = s.ships[p]
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null

            if (hexEquals(from, hex)) {
              const around = revealAroundShip(
                s.cells,
                s.landscapeDeck,
                s.planetNames,
                hex,
              )
              let log = appendLog(
                s.log,
                s.day,
                `${playerLabel(p)} bleibt stehen.`,
              )
              if (around.revealed.length > 0) {
                log = appendLog(
                  log,
                  s.day,
                  `Auto-Erkundung: ${around.revealed.join(' · ')}`,
                )
              }
              return {
                cells: around.cells,
                landscapeDeck: around.deck,
                planetNames: around.planetNames,
                shipMoved: { ...s.shipMoved, [p]: true },
                heldShip: null,
                log,
              }
            }

            if (!cell.revealed) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Unentdecktes Feld — nicht begehbar.',
                ),
              }
            }
            const other: PlayerId = p === 1 ? 2 : 1
            if (hexEquals(s.ships[other], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Feld vom anderen Raumschiff besetzt.',
                ),
              }
            }

            const around = revealAroundShip(
              s.cells,
              s.landscapeDeck,
              s.planetNames,
              hex,
            )
            let log = appendLog(
              s.log,
              s.day,
              `${playerLabel(p)} fliegt nach (${hex.q},${hex.r}). → ${playerLabel(other)}`,
            )
            if (around.revealed.length > 0) {
              log = appendLog(
                log,
                s.day,
                `Auto-Erkundung: ${around.revealed.join(' · ')} (${around.deck.length} Stapel)`,
              )
            }
            if (SOURCE_TERRAINS.has(cell.terrain)) {
              const dir = around.cells[key]?.sourceDir ?? cell.sourceDir
              log = appendLog(
                log,
                s.day,
                `Auf Quelle — Pfeil ${dir ?? '?'} darf gedreht werden.`,
              )
            }

            return {
              ships: { ...s.ships, [p]: { ...hex } },
              cells: around.cells,
              landscapeDeck: around.deck,
              planetNames: around.planetNames,
              shipMoved: { ...s.shipMoved, [p]: true },
              selectedHex: hex,
              heldShip: null,
              activePlayer: other,
              log,
            }
          })
        },

        skipShipMove: () => {
          commit((s) => {
            const p = s.activePlayer
            const other: PlayerId = p === 1 ? 2 : 1
            const ship = s.ships[p]
            const around = revealAroundShip(
              s.cells,
              s.landscapeDeck,
              s.planetNames,
              ship,
            )
            let log = appendLog(
              s.log,
              s.day,
              `${playerLabel(p)} bleibt stehen. → ${playerLabel(other)}`,
            )
            if (around.revealed.length > 0) {
              log = appendLog(
                log,
                s.day,
                `Auto-Erkundung: ${around.revealed.join(' · ')}`,
              )
            }
            return {
              cells: around.cells,
              landscapeDeck: around.deck,
              planetNames: around.planetNames,
              shipMoved: { ...s.shipMoved, [p]: true },
              activePlayer: other,
              log,
            }
          })
        },

        exploreHex: (hex) => {
          // Soft fallback: force-reveal around active ship if target is a neighbor
          commit((s) => {
            const p = s.activePlayer
            const ship = s.ships[p]
            if (hexDistance(ship, hex) !== 1 && !hexEquals(ship, hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Erkundung nur um das eigene Raumschiff (automatisch beim Bewegen).',
                ),
              }
            }
            const around = revealAroundShip(
              s.cells,
              s.landscapeDeck,
              s.planetNames,
              ship,
            )
            if (around.revealed.length === 0) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Keine neuen Nachbarn (schon entdeckt oder Stapel leer).',
                ),
              }
            }
            return {
              cells: around.cells,
              landscapeDeck: around.deck,
              planetNames: around.planetNames,
              log: appendLog(
                s.log,
                s.day,
                `Auto-Erkundung: ${around.revealed.join(' · ')}`,
              ),
            }
          })
        },

        approveConsumer: (hex, type) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            const owner = s.activePlayer
            if (!cell || !cell.revealed || cell.terrain !== 'planet') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Verbraucher nur auf aufgedeckten Planeten.',
                ),
              }
            }
            if (
              cell.planetOwner != null &&
              cell.planetOwner !== owner &&
              cell.consumers.length > 0
            ) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Planet gehört ${playerLabel(cell.planetOwner)} — keine Genehmigung.`,
                ),
              }
            }
            if (!canActOnOwnedOrShip(s.cells, s.ships, owner, hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Verbraucher nur auf eigenem Planeten oder mit Raumschiff dort.',
                ),
              }
            }

            const paid = payToBank(s.players, s.bank, owner, 1)
            if (!paid) {
              return {
                log: appendLog(s.log, s.day, 'Nicht genug Geld (1) für Verbraucher.'),
              }
            }

            const unit: ConsumerUnit = {
              id: uid('cons'),
              type,
              approver: owner,
            }
            const nextPlayer: PlayerId = nextClockwise(owner)
            return {
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  consumers: [...cell.consumers, unit],
                  planetOwner: owner,
                },
              },
              players: paid.players,
              bank: paid.bank,
              activePlayer: nextPlayer,
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(owner)} genehmigt ${METER_LABELS[type]}-Verbraucher auf ${cell.planetName ?? `(${hex.q},${hex.r})`} — Planet gehört ${playerLabel(owner)}. → ${playerLabel(nextPlayer)}`,
              ),
            }
          })
        },

        seedSourcesForEmit: () => {
          commit((s) => {
            const count = Object.values(s.cells).filter(
              (c) => c.revealed && SOURCE_TERRAINS.has(c.terrain),
            ).length
            return {
              cells: seedSourceCharges(s.cells),
              log: appendLog(
                s.log,
                s.day,
                `Emit: ${count} Quelle(n) erhalten je 1 zufälligen Chip.`,
              ),
            }
          })
        },

        adjustMeter: (hex, meter, delta) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell || cell.terrain !== 'planet' || delta === 0) return null
            const nextValue = cell[meter] + delta
            const cells = {
              ...s.cells,
              [key]: { ...cell, [meter]: nextValue },
            }
            const match =
              delta > 0
                ? cell.consumers.find((c) => c.type === meter)
                : undefined
            const owner = cell.planetOwner ?? match?.approver
            if (!match || !owner) return { cells }
            const earned = earnFromBank(s.players, s.bank, owner, delta)
            const name = cell.planetName ?? `(${hex.q},${hex.r})`
            return {
              cells,
              players: earned.players,
              bank: earned.bank,
              log: appendLog(
                s.log,
                s.day,
                `${name} ${METER_LABELS[meter]} ${formatMeterDelta(delta)} · ${playerLabel(owner)} +${delta} Geld${earned.owedNote}.`,
              ),
            }
          })
        },

        rollDice: () => {
          const dir = (Math.floor(Math.random() * 6) + 1) as DirIndex
          commit((s) => ({
            lastDice: dir,
            log: appendLog(s.log, s.day, `Würfel: ${dir}`),
          }))
          return dir
        },

        drawFromBag: () => {
          const color = randomColor()
          setUi((s) => ({
            log: appendLog(s.log, s.day, `Beutel: ${color}`),
          }))
          return color
        },

        placeField: (hex, kind, owner) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null
            if (!cell.revealed) {
              return {
                log: appendLog(s.log, s.day, 'Unentdecktes Feld — kein Bau.'),
              }
            }
            const def = FIELD_DEFS[kind]
            const recharging =
              cell.field?.kind === kind && def.startCharge > 0
            if (cell.field && !recharging) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Nur leere Felder bebauen (oder Feld mit Start-Ladung nachladen).',
                ),
              }
            }
            if (!cell.field && cell.terrain !== 'empty') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Nur leere Weltraum-Felder bebauen.',
                ),
              }
            }
            const paid = payToBank(s.players, s.bank, owner, def.cost)
            if (!paid) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Nicht genug Geld (${def.cost}) für ${def.name}.`,
                ),
              }
            }
            const charge: ChipColor[] = []
            for (let i = 0; i < def.startCharge; i++) {
              charge.push(randomColor())
            }
            const nextPlayer: PlayerId = nextClockwise(owner)
            const action = recharging ? 'lädt' : 'baut'
            return {
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  field: {
                    kind,
                    owner: recharging && cell.field ? cell.field.owner : owner,
                    charge,
                  },
                },
              },
              players: paid.players,
              bank: paid.bank,
              activePlayer: nextPlayer,
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(owner)} ${action} ${def.name} auf (${hex.q},${hex.r}) für ${def.cost} Geld. → ${playerLabel(nextPlayer)}`,
              ),
            }
          })
        },

        removeField: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell?.field) return null
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, field: undefined },
              },
              log: appendLog(
                s.log,
                s.day,
                `Feld entfernt (${hex.q},${hex.r}).`,
              ),
            }
          })
        },

        removeAt: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null

            const flyingHere = [...s.chips]
              .reverse()
              .find((c) => c.state === 'flying' && hexEquals(c.hex, hex))
            if (flyingHere) {
              return {
                chips: s.chips.filter((c) => c.id !== flyingHere.id),
                selectedChipId:
                  s.selectedChipId === flyingHere.id ? null : s.selectedChipId,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${flyingHere.color} entfernt.`,
                ),
              }
            }
            const freeHere = [...s.chips]
              .reverse()
              .find((c) => c.state === 'free' && hexEquals(c.hex, hex))
            if (freeHere) {
              return {
                chips: s.chips.filter((c) => c.id !== freeHere.id),
                selectedChipId:
                  s.selectedChipId === freeHere.id ? null : s.selectedChipId,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${freeHere.color} entfernt.`,
                ),
              }
            }
            if (cell.field) {
              return {
                cells: {
                  ...s.cells,
                  [key]: { ...cell, field: undefined },
                },
                log: appendLog(
                  s.log,
                  s.day,
                  `Feld ${FIELD_DEFS[cell.field.kind].name} entfernt.`,
                ),
              }
            }
            if (cell.consumers.length > 0) {
              const next = cell.consumers.slice(0, -1)
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    consumers: next,
                    planetOwner:
                      next.length === 0 ? undefined : cell.planetOwner,
                  },
                },
                log: appendLog(
                  s.log,
                  s.day,
                  `Verbraucher entfernt (${hex.q},${hex.r}).`,
                ),
              }
            }
            if (cell.sourceStock.length > 0) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    sourceStock: cell.sourceStock.slice(0, -1),
                  },
                },
                log: appendLog(s.log, s.day, `Ladung entfernt.`),
              }
            }
            return {
              log: appendLog(
                s.log,
                s.day,
                `Nichts zum Entfernen auf (${hex.q},${hex.r}).`,
              ),
            }
          })
        },

        addStockChip: (hex, color, bound) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null
            if (bound && cell.field) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    field: {
                      ...cell.field,
                      charge: [...cell.field.charge, color],
                    },
                  },
                },
              }
            }
            if (bound && !cell.field) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    sourceStock: [...cell.sourceStock, color],
                  },
                },
              }
            }
            return {
              chips: [
                ...s.chips,
                {
                  id: uid('chip'),
                  color,
                  state: 'free' as const,
                  hex: { ...hex },
                },
              ],
            }
          })
        },

        removeStockAt: (hex, bound) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null
            if (bound && cell.field && cell.field.charge.length > 0) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    field: {
                      ...cell.field,
                      charge: cell.field.charge.slice(0, -1),
                    },
                  },
                },
              }
            }
            if (bound && cell.sourceStock.length > 0) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    sourceStock: cell.sourceStock.slice(0, -1),
                  },
                },
              }
            }
            const free = s.chips.find(
              (c) => c.state === 'free' && hexEquals(c.hex, hex),
            )
            if (free) {
              return { chips: s.chips.filter((c) => c.id !== free.id) }
            }
            return null
          })
        },

        releaseCharge: (hex, count) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null
            const pool = cell.field ? cell.field.charge : cell.sourceStock
            const take = pool.slice(-count)
            const left = pool.slice(0, Math.max(0, pool.length - count))
            const newChips: Chip[] = take.map((color) => ({
              id: uid('chip'),
              color,
              state: 'free' as const,
              hex: { ...hex },
            }))
            if (cell.field) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    field: { ...cell.field, charge: left },
                  },
                },
                chips: [...s.chips, ...newChips],
                log: appendLog(
                  s.log,
                  s.day,
                  `${take.length} Ladung(en) gelöst auf (${hex.q},${hex.r}).`,
                ),
              }
            }
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, sourceStock: left },
              },
              chips: [...s.chips, ...newChips],
              log: appendLog(
                s.log,
                s.day,
                `${take.length} Ladung(en) gelöst auf (${hex.q},${hex.r}).`,
              ),
            }
          })
        },

        spawnFlying: (hex, color, dir, resource) => {
          commit((s) => {
            const chip: Chip = {
              id: uid('fly'),
              color,
              state: 'flying',
              hex: { ...hex },
              dir,
              resource,
              stepsLeft: 5,
            }
            return {
              chips: [...s.chips, chip],
              selectedChipId: chip.id,
              heldShip: null,
              tool: 'select',
              log: appendLog(
                s.log,
                s.day,
                `Chip ${color}${resource ? `/${resource}` : ''} fliegt von (${hex.q},${hex.r}) Richtung ${dir}.`,
              ),
            }
          })
        },

        moveChipAt: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null

            const held = s.selectedChipId
              ? s.chips.find((c) => c.id === s.selectedChipId)
              : undefined

            if (held && (held.state === 'free' || held.state === 'flying')) {
              if (hexEquals(held.hex, hex)) {
                return {
                  selectedChipId: null,
                  log: appendLog(s.log, s.day, 'Chip-Auswahl aufgehoben.'),
                }
              }
              return {
                chips: s.chips.map((c) =>
                  c.id === held.id ? { ...c, hex: { ...hex } } : c,
                ),
                selectedHex: hex,
                selectedChipId: null,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${held.color} → (${hex.q},${hex.r}).`,
                ),
              }
            }

            const flyingHere = [...s.chips]
              .reverse()
              .find((c) => c.state === 'flying' && hexEquals(c.hex, hex))
            if (flyingHere) {
              return {
                selectedChipId: flyingHere.id,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${flyingHere.color} aufgenommen (fliegend). Zielhex klicken.`,
                ),
              }
            }

            const freeHere = [...s.chips]
              .reverse()
              .find((c) => c.state === 'free' && hexEquals(c.hex, hex))
            if (freeHere) {
              return {
                selectedChipId: freeHere.id,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip ${freeHere.color} aufgenommen. Zielhex klicken.`,
                ),
              }
            }

            if (cell.field && cell.field.charge.length > 0) {
              const color = cell.field.charge[cell.field.charge.length - 1]
              const chip: Chip = {
                id: uid('chip'),
                color,
                state: 'free',
                hex: { ...hex },
              }
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    field: {
                      ...cell.field,
                      charge: cell.field.charge.slice(0, -1),
                    },
                  },
                },
                chips: [...s.chips, chip],
                selectedChipId: chip.id,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Ladung ${color} gelöst & aufgenommen. Zielhex klicken.`,
                ),
              }
            }

            if (cell.sourceStock.length > 0) {
              const color = cell.sourceStock[cell.sourceStock.length - 1]
              const resource = SOURCE_RESOURCE[cell.terrain]
              const chip: Chip = {
                id: uid('chip'),
                color,
                state: 'free',
                hex: { ...hex },
                resource,
              }
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    sourceStock: cell.sourceStock.slice(0, -1),
                  },
                },
                chips: [...s.chips, chip],
                selectedChipId: chip.id,
                selectedHex: hex,
                log: appendLog(
                  s.log,
                  s.day,
                  `Ladung ${color} aufgenommen. Zielhex klicken.`,
                ),
              }
            }

            return {
              log: appendLog(
                s.log,
                s.day,
                `Kein Chip auf (${hex.q},${hex.r}).`,
              ),
            }
          })
        },

        stepChip: (chipId) => {
          commit((s) => {
            const chip = s.chips.find((c) => c.id === chipId)
            if (!chip || chip.state !== 'flying' || !chip.dir) return null

            const next = neighbor(chip.hex, chip.dir)
            const nextCell = s.cells[hexKey(next)]

            // Outside board or asteroid → bag (fog keeps the chip visible)
            if (!nextCell || (nextCell.revealed && nextCell.terrain === 'mountain')) {
              const reason = nextCell ? 'Asteroid' : 'Wand'
              return {
                chips: s.chips.filter((c) => c.id !== chipId),
                selectedChipId:
                  s.selectedChipId === chipId ? null : s.selectedChipId,
                log: appendLog(
                  s.log,
                  s.day,
                  `${reason} absorbiert Chip ${chip.color} → Beutel.`,
                ),
              }
            }

            const shipOwner = shipOnHex(s.ships, next)
            const chips = s.chips.map((c) =>
              c.id === chipId
                ? {
                    ...c,
                    hex: next,
                    stepsLeft: Math.max(0, (c.stepsLeft ?? 1) - 1),
                  }
                : c,
            )

            if (shipOwner) {
              return {
                chips,
                selectedHex: next,
                selectedChipId: chipId,
                tool: 'select',
                log: appendLog(
                  s.log,
                  s.day,
                  `Chip auf Raumschiff ${playerLabel(shipOwner)} — Richtung wählen (Umleitung), dann weiter.`,
                ),
              }
            }

            return {
              chips,
              selectedHex: next,
            }
          })
        },

        setChipDir: (chipId, dir) => {
          commit((s) => ({
            chips: s.chips.map((c) =>
              c.id === chipId ? { ...c, dir } : c,
            ),
          }))
        },

        setChipResource: (chipId, resource) => {
          commit((s) => ({
            chips: s.chips.map((c) =>
              c.id === chipId ? { ...c, resource } : c,
            ),
          }))
        },

        landChip: (chipId, as) => {
          commit((s) => ({
            chips: s.chips.map((c) =>
              c.id === chipId
                ? { ...c, state: as, dir: undefined, stepsLeft: undefined }
                : c,
            ),
          }))
        },

        removeChip: (chipId) => {
          commit((s) => ({
            chips: s.chips.filter((c) => c.id !== chipId),
            selectedChipId:
              s.selectedChipId === chipId ? null : s.selectedChipId,
          }))
        },

        applyChipToPlanet: (chipId) => {
          commit((s) => {
            const chip = s.chips.find((c) => c.id === chipId)
            if (!chip) return null
            const key = hexKey(chip.hex)
            const cell = s.cells[key]
            if (!cell || !cell.revealed || cell.terrain !== 'planet') {
              return {
                log: appendLog(s.log, s.day, 'Kein Planet unter dem Chip.'),
              }
            }

            const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
            const chips = s.chips.filter((c) => c.id !== chipId)
            const selectedChipId =
              s.selectedChipId === chipId ? null : s.selectedChipId

            if (chip.resource === 'uranium' || chip.resource === 'light') {
              return {
                chips,
                selectedChipId,
                log: appendLog(
                  s.log,
                  s.day,
                  `${name}: ${chip.resource === 'uranium' ? 'Uran' : 'Licht'} verschwindet ohne Effekt.`,
                ),
              }
            }

            const meter: MeterKind | null =
              chip.resource === 'voltage' ||
              chip.resource === 'water' ||
              chip.resource === 'heat'
                ? chip.resource
                : null
            if (!meter) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Chip braucht Ressource Spannung/Wasser/Wärme.',
                ),
              }
            }

            const energy = CHIP_ENERGY[chip.color]
            const hasMatch = cell.consumers.some((c) => c.type === meter)
            let players = s.players
            let bank = s.bank
            let payNote = ' · kein passender Verbraucher (kein Einkommen)'
            if (hasMatch && cell.planetOwner) {
              const earned = earnFromBank(
                s.players,
                s.bank,
                cell.planetOwner,
                energy,
              )
              players = earned.players
              bank = earned.bank
              payNote = ` · ${playerLabel(cell.planetOwner)} +${energy} Geld${earned.owedNote}`
            }

            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, [meter]: cell[meter] + energy },
              },
              players,
              bank,
              chips,
              selectedChipId,
              log: appendLog(
                s.log,
                s.day,
                `${name} +${energy} ${METER_SHORT[meter]} (${chip.color})${payNote}.`,
              ),
            }
          })
        },

        emitFromSource: (hex, dir) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (
              !cell ||
              !cell.revealed ||
              !SOURCE_TERRAINS.has(cell.terrain)
            ) {
              return {
                log: appendLog(s.log, s.day, 'Keine Quelle auf diesem Feld.'),
              }
            }

            const flyDir = dir ?? cell.sourceDir ?? ((s.lastDice ?? 3) as DirIndex)
            const resource = SOURCE_RESOURCE[cell.terrain]
            let color: ChipColor
            let cells = s.cells
            let log = s.log
            if (cell.sourceStock.length > 0) {
              color = cell.sourceStock[cell.sourceStock.length - 1]
              cells = {
                ...s.cells,
                [key]: {
                  ...cell,
                  sourceStock: cell.sourceStock.slice(0, -1),
                },
              }
            } else {
              color = randomColor()
              log = appendLog(log, s.day, `Beutel: ${color}`)
            }

            const chip: Chip = {
              id: uid('fly'),
              color,
              state: 'flying',
              hex: { ...hex },
              dir: flyDir,
              resource,
              stepsLeft: 5,
            }
            return {
              cells,
              chips: [...s.chips, chip],
              selectedChipId: chip.id,
              heldShip: null,
              tool: 'select',
              log: appendLog(
                log,
                s.day,
                `Chip ${color}/${resource} fliegt von (${hex.q},${hex.r}) Richtung ${flyDir} (Pfeil).`,
              ),
            }
          })
        },

        setSourceDir: (hex, dir) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell || !cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) {
              return {
                log: appendLog(s.log, s.day, 'Kein Quellenpfeil auf diesem Feld.'),
              }
            }
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, sourceDir: dir },
              },
              log: appendLog(
                s.log,
                s.day,
                `Quellenpfeil (${hex.q},${hex.r}) → ${dir}.`,
              ),
            }
          })
        },

        setTerrain: (hex, terrain) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null
            let planetNames = s.planetNames
            let planetName = cell.planetName
            if (terrain === 'planet' && !planetName) {
              if (planetNames.length > 0) {
                planetName = planetNames[0]
                planetNames = planetNames.slice(1)
              } else {
                planetName = `Planet-${hex.q},${hex.r}`
              }
            }
            if (terrain !== 'planet') planetName = undefined
            const sourceDir = SOURCE_TERRAINS.has(terrain)
              ? cell.sourceDir ?? (rollDie() as DirIndex)
              : undefined
            return {
              planetNames,
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  revealed: true,
                  terrain,
                  planetName,
                  consumers: terrain === 'planet' ? cell.consumers : [],
                  planetOwner:
                    terrain === 'planet' ? cell.planetOwner : undefined,
                  voltage: terrain === 'planet' ? cell.voltage : 0,
                  water: terrain === 'planet' ? cell.water : 0,
                  heat: terrain === 'planet' ? cell.heat : 0,
                  sourceDir,
                },
              },
            }
          })
        },

        newDay: () => {
          commit((s) => {
            const day = s.day + 1
            return {
              day,
              shipMoved: { 1: false, 2: false },
              log: appendLog(s.log, day, `Tag ${day} beginnt.`),
            }
          })
        },

        checkCritical: () => {
          commit((s) => {
            const destroyed = applyColonyDestruction(s.cells, s.day, s.log)
            if (destroyed.cells !== s.cells) {
              return { cells: destroyed.cells, log: destroyed.log }
            }
            const flyingOrFree = s.chips.filter(
              (c) => c.state === 'flying' || c.state === 'free',
            ).length
            if (flyingOrFree > 8 && !s.lost) {
              return {
                lost: true,
                lossReason: `${flyingOrFree} ungebundene/fliegende Chips (Grenze: 8). Beide verloren.`,
                log: appendLog(
                  s.log,
                  s.day,
                  `Kritische Stromnetz-Grenze: ${flyingOrFree} Chips > 8.`,
                ),
              }
            }
            return null
          })
        },

        pushLog: (msg) =>
          setUi((s) => ({
            log: appendLog(s.log, s.day, msg),
          })),
      }
    },
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        ...takeSnapshot(s),
        past: s.past,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.approveType === undefined) state.approveType = null
        if (state.heldShip === undefined) state.heldShip = null
        if (
          state.tool !== 'select' &&
          state.tool !== 'place' &&
          state.tool !== 'remove'
        ) {
          state.tool = 'select'
        }
        if (!state.ships) {
          state.ships = {
            1: { ...SHIP_SPAWNS[1] },
            2: { ...SHIP_SPAWNS[2] },
          }
        }
        if (!state.landscapeDeck) state.landscapeDeck = []
        if (!state.planetNames) state.planetNames = shufflePlanetNames()
        if (!state.shipMoved) state.shipMoved = { 1: false, 2: false }
        if (state.orderHolder == null) state.orderHolder = 1
        if (state.players) {
          for (const p of [1, 2] as PlayerId[]) {
            if (state.players[p] && state.players[p].owed == null) {
              state.players[p].owed = 0
            }
          }
        }
        if (state.bank == null) {
          const held =
            (state.players?.[1]?.money ?? 0) + (state.players?.[2]?.money ?? 0)
          state.bank = Math.max(0, BANK_START - held)
        }
        state.phase = normalizePhase(state.phase as string)
        for (const snap of state.past ?? []) {
          snap.phase = normalizePhase(snap.phase as string)
        }
        // Migrate old cells without revealed
        if (state.cells) {
          for (const cell of Object.values(state.cells)) {
            if (cell.revealed === undefined) {
              ;(cell as CellState).revealed = true
            }
          }
        }
        syncIdSeq(state.chips ?? [], state.cells ?? {})
      },
    },
  ),
)
