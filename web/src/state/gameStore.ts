import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  allBoardHexes,
  BANK_START,
  buildLandscapeDecks,
  CRITICAL_LIMIT,
  SHIP_SPAWNS,
  ZONE_LABELS,
  zoneOf,
  type LandscapeDecks,
} from '../data/boardLayout'
import { FIELD_DEFS } from '../data/fields'
import {
  clampFee,
  classifyFactoryHit,
  departureKind,
  paidEffectLabel,
  resourceName,
  rollDir,
  supplyPayout,
} from './factoryHit'
import { METER_LABELS, METER_SHORT, playerLabel } from '../data/labels'
import { shufflePlanetNames } from '../data/planetNames'
import {
  hexDistance,
  hexEquals,
  hexKey,
  neighbor,
} from '../hex/math'
import {
  DIRECTIONS,
  type Axial,
  type CellState,
  type Chip,
  type ChipColor,
  type ChipResource,
  type ConsumerUnit,
  type DirIndex,
  type FieldKind,
  type LandscapeTerrain,
  type MeterKind,
  type PhaseId,
  type PendingHit,
  type PlayerId,
  type PlayerState,
  type ToolMode,
  type Winner,
} from '../types'

const PHASES: { id: PhaseId; label: string; hint: string }[] = [
  {
    id: 'order',
    label: 'Rundenstart',
    hint: 'Zuerst, ob die Bank leer ist. Dann 1 Geld Unterhalt pro Fabrik. Wer das nicht zahlen kann, schließt Fabriken, bis der Rest bezahlbar ist. Danach kritische Kolonien, Reihenfolgechip, Bedarf und Emission.',
  },
  {
    id: 'act',
    label: 'Aktionen',
    hint: 'Zuerst der Inhaber des Reihenfolgechips, danach der andere Spieler. Eine Aktion ist ein Schritt oder ein Bau. Bauen geht auf dem Feld des Schiffs oder direkt daneben. Übrige Punkte verfallen.',
  },
  {
    id: 'simulate',
    label: 'Simulation',
    hint: 'Fabrikeffekte lösen aus, sobald die Gebühr bezahlt werden kann. Zum dritten Mal auf demselben Feld ist der Chip weg. Ein Schiff leitet nur auf einem leeren Feld um.',
  },
]

export { PHASES }

const STORAGE_KEY = 'reaktor-playtest-v11'
const START_MONEY = 6
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
 * Draw one landscape tile from the stack of the hex's zone.
 * Returns null when the hex is missing, already open, or that stack is empty.
 */
function revealHex(
  cells: Record<string, CellState>,
  decks: LandscapeDecks,
  planetNames: string[],
  hex: Axial,
): {
  cells: Record<string, CellState>
  decks: LandscapeDecks
  planetNames: string[]
  label: string
} | null {
  const key = hexKey(hex)
  const cell = cells[key]
  if (!cell || cell.revealed) return null
  const zone = zoneOf(hex)
  const deck = decks[zone]
  if (!deck || deck.length === 0) return null

  const [tile, ...rest] = deck
  let nextNames = planetNames
  let planetName: string | undefined
  if (tile === 'planet') {
    if (nextNames.length > 0) {
      planetName = nextNames[0]
      nextNames = nextNames.slice(1)
    } else {
      planetName = `Planet-${hex.q},${hex.r}`
    }
  }

  const zoneName = ZONE_LABELS[zone]
  const label =
    tile === 'planet' && planetName
      ? `${planetName} (${zoneName})`
      : `${LANDSCAPE_LABELS[tile]} (${zoneName})`

  return {
    cells: {
      ...cells,
      [key]: {
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
        sourceOwner: undefined,
        sourceDir: undefined,
      },
    },
    decks: { ...decks, [zone]: rest },
    planetNames: nextNames,
    label,
  }
}

/**
 * Reveal every still-hidden neighbor of a ship.
 * Each hex draws from the stack of the zone it lies in.
 */
function revealAroundShip(
  cells: Record<string, CellState>,
  decks: LandscapeDecks,
  planetNames: string[],
  shipHex: Axial,
): {
  cells: Record<string, CellState>
  decks: LandscapeDecks
  planetNames: string[]
  revealed: string[]
} {
  let nextCells = cells
  let nextDecks = decks
  let nextNames = planetNames
  const revealed: string[] = []

  for (let d = 1; d <= 6; d++) {
    const hex = neighbor(shipHex, d as DirIndex)
    const cell = nextCells[hexKey(hex)]
    if (!cell || cell.revealed) continue
    const result = revealHex(nextCells, nextDecks, nextNames, hex)
    if (!result) continue
    nextCells = result.cells
    nextDecks = result.decks
    nextNames = result.planetNames
    revealed.push(result.label)
  }

  return {
    cells: nextCells,
    decks: nextDecks,
    planetNames: nextNames,
    revealed,
  }
}

function chipPilot(chip: Chip, fallback: PlayerId): PlayerId {
  return chip.pilot ?? fallback
}

function canAffordFee(
  players: Record<PlayerId, PlayerState>,
  payer: PlayerId,
  owner: PlayerId,
  fee: number,
): boolean {
  if (fee <= 0 || payer === owner) return true
  return players[payer].money >= fee
}

/** Player-to-player factory fee. Paying yourself is free. */
function payFee(
  players: Record<PlayerId, PlayerState>,
  payer: PlayerId,
  owner: PlayerId,
  fee: number,
): Record<PlayerId, PlayerState> | null {
  if (!canAffordFee(players, payer, owner, fee)) return null
  if (fee <= 0 || payer === owner) return players
  return {
    ...players,
    [payer]: { ...players[payer], money: players[payer].money - fee },
    [owner]: { ...players[owner], money: players[owner].money + fee },
  }
}

function flyOnto(
  chip: Chip,
  dest: Axial,
  dir: DirIndex | undefined,
  resource: Chip['resource'],
): Chip {
  return {
    ...chip,
    hex: { ...dest },
    dir,
    resource,
    dieStep: undefined,
    state: 'flying',
  }
}

/**
 * Move a free or flying chip onto dest.
 * Undiscovered hexes stay hidden — only ships explore.
 * Asteroids and the outer wall send the chip back to the bag.
 * A factory or planet resolves when a flying chip arrives.
 */
function transferChip(
  s: Snapshot,
  chip: Chip,
  dest: Axial,
  mode: 'step' | 'drop',
): Partial<Snapshot> {
  const cell = s.cells[hexKey(dest)]
  if (!cell) {
    return {
      chips: s.chips.filter((c) => c.id !== chip.id),
      selectedChipId: s.selectedChipId === chip.id ? null : s.selectedChipId,
      log: appendLog(
        s.log,
        s.day,
        `Wand absorbiert Chip ${chip.color} → Beutel.`,
      ),
    }
  }

  let log = s.log

  if (!cell.revealed) {
    log = appendLog(
      log,
      s.day,
      `Unentdecktes Feld (${dest.q},${dest.r}) — Chip fliegt weiter.`,
    )
  } else if (cell.terrain === 'mountain') {
    return {
      chips: s.chips.filter((c) => c.id !== chip.id),
      selectedChipId: s.selectedChipId === chip.id ? null : s.selectedChipId,
      selectedHex: dest,
      log: appendLog(
        log,
        s.day,
        `Asteroid absorbiert Chip ${chip.color} → Beutel.`,
      ),
    }
  }

  const visitKey = hexKey(dest)
  const seen =
    chip.state === 'flying' && mode === 'step'
      ? { ...(chip.seen ?? {}), [visitKey]: (chip.seen?.[visitKey] ?? 0) + 1 }
      : chip.seen
  if (seen && seen[visitKey] >= 3) {
    return {
      chips: s.chips.filter((c) => c.id !== chip.id),
      selectedChipId: s.selectedChipId === chip.id ? null : s.selectedChipId,
      selectedHex: dest,
      pendingHit: null,
      log: appendLog(
        log,
        s.day,
        `Endlosschleife: Chip ${chip.color} zum dritten Mal auf (${dest.q},${dest.r}) — zurück in den Beutel.`,
      ),
    }
  }

  const arrived: Chip = {
    ...chip,
    hex: { ...dest },
    dieStep: undefined,
    seen,
    stepsLeft:
      mode === 'step' ? Math.max(0, (chip.stepsLeft ?? 1) - 1) : chip.stepsLeft,
  }
  const chips = s.chips.map((c) => (c.id === chip.id ? arrived : c))

  if (mode === 'drop') {
    log = appendLog(log, s.day, `Chip ${chip.color} → (${dest.q},${dest.r}).`)
  }

  const landed: Partial<Snapshot> = {
    chips,
    selectedHex: dest,
    selectedChipId: mode === 'step' ? chip.id : null,
    heldShip: mode === 'drop' ? null : s.heldShip,
    pendingHit: null,
    log,
  }

  if (chip.state !== 'flying' || !cell.revealed) return landed

  const shipOwner = shipOnHex(s.ships, dest)
  const factory = cell.field
  const planet = cell.terrain === 'planet'
  if (factory) return settleFactory(s, landed, arrived, cell, dest)
  if (planet) return settlePlanet(s, landed, arrived, cell)
  if (shipOwner) {
    return {
      ...landed,
      tool: 'select',
      log: appendLog(
        log,
        s.day,
        `Chip auf Raumschiff ${playerLabel(shipOwner)} — Richtung wählen (Umleitung), dann weiter.`,
      ),
    }
  }
  return landed
}

function settleFactory(
  s: Snapshot,
  landed: Partial<Snapshot>,
  chip: Chip,
  cell: CellState,
  dest: Axial,
): Partial<Snapshot> {
  const field = cell.field!
  const kind = classifyFactoryHit(field, chip)
  const name = FIELD_DEFS[field.kind].name
  if (kind === 'straight') {
    return {
      ...landed,
      log: appendLog(
        landed.log ?? s.log,
        s.day,
        `${name}: keine Interaktion mit ${resourceName(chip.resource)} — geradeaus.`,
      ),
    }
  }
  const payer = chipPilot(chip, s.activePlayer)
  const fee = clampFee(field.fee ?? 0)
  if (!canAffordFee(s.players, payer, field.owner, fee)) {
    return {
      ...landed,
      log: appendLog(
        landed.log ?? s.log,
        s.day,
        `${name}: Gebühr ${fee} nicht bezahlbar — ${resourceName(chip.resource)} fliegt geradeaus.`,
      ),
    }
  }
  const base: Snapshot = {
    ...s,
    chips: landed.chips ?? s.chips,
    log: landed.log ?? s.log,
    pendingHit: null,
    selectedChipId: chip.id,
    selectedHex: dest,
  }
  const applied = applyPaidFactory(base, chip, cell, dest)
  return departIfFlying(base, applied, chip.id)
}

function settlePlanet(
  s: Snapshot,
  landed: Partial<Snapshot>,
  chip: Chip,
  cell: CellState,
): Partial<Snapshot> {
  const impact = planetImpact(s, chip, cell)
  if (!impact) return landed
  return {
    ...landed,
    ...impact,
    pendingHit: null,
    selectedChipId:
      (impact.selectedChipId as string | null | undefined) ??
      (landed.selectedChipId === chip.id ? null : landed.selectedChipId),
  }
}

/** Planet hit from the rules: meter moves right, controller is paid the open demand. */
function planetImpact(
  s: Snapshot,
  chip: Chip,
  cell: CellState,
): Partial<Snapshot> | null {
  const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
  const chips = s.chips.filter((c) => c.id !== chip.id)
  const selectedChipId = s.selectedChipId === chip.id ? null : s.selectedChipId
  if (chip.resource === 'uranium' || chip.resource === 'light') {
    return {
      chips,
      selectedChipId,
      log: appendLog(
        s.log,
        s.day,
        `${name}: ${resourceName(chip.resource)} verschwindet ohne Effekt.`,
      ),
    }
  }
  const meter: MeterKind | null =
    chip.resource === 'voltage' ||
    chip.resource === 'water' ||
    chip.resource === 'heat'
      ? chip.resource
      : null
  if (!meter) return null

  const before = cell[meter]
  const energy = CHIP_ENERGY[chip.color]
  const hasMatch = cell.consumers.some((c) => c.type === meter)
  const payer = chipPilot(chip, s.activePlayer)
  let players = s.players
  let bank = s.bank
  let payNote = ' · kein passender Verbraucher'
  if (hasMatch) {
    const payout = supplyPayout(before, energy)
    if (payout > 0) {
      const earned = earnFromBank(s.players, s.bank, payer, payout)
      players = earned.players
      bank = earned.bank
      payNote = ` · ${playerLabel(payer)} +${payout} Geld (Bedarf vor dem Treffer ${before})${earned.owedNote}`
    } else {
      payNote = ` · ${playerLabel(payer)} +0 (Messgerät war ${before})`
    }
  }
  return {
    cells: {
      ...s.cells,
      [hexKey(cell.hex)]: { ...cell, [meter]: before + energy },
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
}

/** After a fee choice, fly one more hex if the chip is still in the air. */
function departIfFlying(
  s: Snapshot,
  applied: Partial<Snapshot>,
  chipId: string,
): Partial<Snapshot> {
  if (applied.pendingHit) return applied
  const chips = applied.chips ?? s.chips
  const chip = chips.find((c) => c.id === chipId)
  if (!chip || chip.state !== 'flying' || !chip.dir) return applied
  const next: Snapshot = {
    ...s,
    ...applied,
    chips,
    pendingHit: null,
  }
  const flown = transferChip(next, chip, neighbor(chip.hex, chip.dir), 'step')
  return {
    ...flown,
    players: flown.players ?? next.players,
    bank: flown.bank ?? next.bank,
  }
}

function applyPaidFactory(
  s: Snapshot,
  chip: Chip,
  cell: CellState,
  dest: Axial,
): Partial<Snapshot> {
  const field = cell.field!
  const how = departureKind(field, chip)
  const arrow = field.dir ?? chip.dir
  const key = hexKey(dest)
  const name = FIELD_DEFS[field.kind].name
  const payer = chipPilot(chip, s.activePlayer)
  const fee = clampFee(field.fee ?? 0)
  const players = payFee(s.players, payer, field.owner, fee)
  if (!players) {
    return {
      log: appendLog(s.log, s.day, `Gebühr ${fee} nicht bezahlbar.`),
    }
  }
  const feeNote =
    fee <= 0 || payer === field.owner
      ? `Gebühr ${fee}`
      : `${playerLabel(payer)} zahlt ${fee} an ${playerLabel(field.owner)}`

  if (how === 'color') {
    return {
      players,
      pendingHit: { chipId: chip.id, hex: { ...dest }, mode: 'color' },
      selectedChipId: chip.id,
      log: appendLog(
        s.log,
        s.day,
        `${name}: ${feeNote}. Farbe für die Wärme wählen.`,
      ),
    }
  }

  if (how === 'store') {
    const stored =
      field.kind === 'pumped' ? chip.resource : ('water' as const)
    return {
      players,
      cells: {
        ...s.cells,
        [key]: {
          ...cell,
          field: {
            ...field,
            charge: [...field.charge, chip.color],
            chargeResource: field.kind === 'pumped' ? stored : field.chargeResource,
          },
        },
      },
      chips: s.chips.filter((c) => c.id !== chip.id),
      selectedChipId: s.selectedChipId === chip.id ? null : s.selectedChipId,
      pendingHit: null,
      log: appendLog(
        s.log,
        s.day,
        `${name}: ${resourceName(chip.resource)} ${chip.color} wird Ladung (${field.charge.length + 1}). ${feeNote}.`,
      ),
    }
  }

  const dir = how === 'arrow' ? arrow : rollDir()
  if (!dir) {
    return {
      log: appendLog(s.log, s.day, `${name} hat keinen Pfeil.`),
    }
  }
  let resource = chip.resource
  if (field.kind === 'solar') resource = 'voltage'
  if (field.kind === 'thermalCell' || field.kind === 'nuclearPlant') resource = 'heat'
  const aim =
    how === 'arrow'
      ? `Pfeil ${dir} ${DIRECTIONS[dir - 1].label}`
      : how === 'die'
        ? `Würfel ${dir} ${DIRECTIONS[dir - 1].label}`
        : `Zufall ${dir} ${DIRECTIONS[dir - 1].label}`

  let nextField = field
  const extra: Chip[] = []
  if (field.kind === 'turbine' && chip.resource === 'heat' && field.charge.length > 0) {
    resource = 'voltage'
    const color = field.charge[0]
    nextField = { ...field, charge: field.charge.slice(1) }
    extra.push(
      flyOnto(
        {
          ...chip,
          id: uid('fly'),
          color,
          resource: 'voltage',
          stepsLeft: chip.stepsLeft,
          seen: {},
        },
        dest,
        dir,
        'voltage',
      ),
    )
  }
  if (field.kind === 'transformer' && field.charge.length > 0) {
    resource = 'voltage'
    const color = field.charge[0]
    nextField = { ...field, charge: field.charge.slice(1) }
    extra.push(
      flyOnto(
        {
          ...chip,
          id: uid('fly'),
          color,
          resource: 'voltage',
          stepsLeft: chip.stepsLeft,
          seen: {},
        },
        dest,
        dir,
        'voltage',
      ),
    )
  }

  const updated = flyOnto(chip, dest, dir, resource)
  return {
    players,
    cells: {
      ...s.cells,
      [key]: { ...cell, field: nextField },
    },
    chips: [
      ...s.chips.map((c) => (c.id === chip.id ? updated : c)),
      ...extra,
    ],
    pendingHit: null,
    selectedChipId: chip.id,
    log: appendLog(
      s.log,
      s.day,
      `${name}: ${resourceName(resource)} fliegt ${aim}.${extra.length ? ` Zweite ${extra[0].color}-Spannung dabei.` : ''} ${feeNote}.`,
    ),
  }
}

function setupBoard(rng: () => number = Math.random): {
  cells: Record<string, CellState>
  landscapeDecks: LandscapeDecks
  planetNames: string[]
  logLines: string[]
} {
  let cells = makeCells()
  let landscapeDecks = buildLandscapeDecks(rng)
  let planetNames = shufflePlanetNames(rng)
  const logLines: string[] = []

  for (const p of [1, 2] as PlayerId[]) {
    const result = revealAroundShip(
      cells,
      landscapeDecks,
      planetNames,
      SHIP_SPAWNS[p],
    )
    cells = result.cells
    landscapeDecks = result.decks
    planetNames = result.planetNames
    if (result.revealed.length > 0) {
      logLines.push(
        `${playerLabel(p)} Start-Erkundung: ${result.revealed.join(' · ')}`,
      )
    }
  }

  return { cells, landscapeDecks, planetNames, logLines }
}

function isDevelopedSource(cell: CellState): boolean {
  return (
    cell.revealed &&
    SOURCE_TERRAINS.has(cell.terrain) &&
    cell.sourceOwner != null &&
    cell.sourceDir != null
  )
}

function sourceVisitNote(cell: CellState): string | null {
  if (!cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) return null
  if (cell.sourceOwner != null && cell.sourceDir != null) {
    const aim = DIRECTIONS[cell.sourceDir - 1].label
    return `Auf Quelle von ${playerLabel(cell.sourceOwner)} — Pfeil ${cell.sourceDir} ${aim}.`
  }
  return 'Auf unerschlossener Quelle — emittiert nicht, bis sie im Bauen erschlossen wird.'
}

/** Drop dice-rolled arrows from saves made before sources had to be bought. */
function silenceUndevelopedSources(cells: Record<string, CellState> | undefined) {
  if (!cells) return
  for (const cell of Object.values(cells)) {
    if (!SOURCE_TERRAINS.has(cell.terrain) || cell.sourceOwner != null) continue
    cell.sourceDir = undefined
    cell.sourceStock = []
  }
}

function emittedSourceColor(terrain: CellState['terrain']): ChipColor {
  if (terrain === 'water') return 'blue'
  if (terrain === 'uranium') return 'red'
  return randomColor()
}

function seedSourceCharges(
  cells: Record<string, CellState>,
): Record<string, CellState> {
  const next = { ...cells }
  let any = false
  for (const [key, cell] of Object.entries(cells)) {
    if (!isDevelopedSource(cell)) continue
    any = true
    next[key] = {
      ...cell,
      sourceStock: [...cell.sourceStock, emittedSourceColor(cell.terrain)],
    }
  }
  return any ? next : cells
}

function emitRevealedSources(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): { cells: Record<string, CellState>; log: string[] } {
  const count = Object.values(cells).filter(isDevelopedSource).length
  const msg =
    count === 0
      ? 'Emit: keine erschlossene Quelle.'
      : `Emit: ${count} erschlossene Quelle(n). Sonne zufällig, Wasser blau, Uran rot.`
  return {
    cells: seedSourceCharges(cells),
    log: appendLog(log, day, msg),
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

/** Ship stands on the hex or on a neighbor. */
function inShipRange(ship: Axial, hex: Axial): boolean {
  return hexDistance(ship, hex) <= 1
}

export type Snapshot = {
  day: number
  phase: PhaseId
  activePlayer: PlayerId
  players: Record<PlayerId, PlayerState>
  cells: Record<string, CellState>
  chips: Chip[]
  ships: Record<PlayerId, Axial>
  landscapeDecks: LandscapeDecks
  /** Remaining unique planet names for newly revealed planets */
  planetNames: string[]
  /** Action points left in the current action phase. Unused points expire. */
  actionsLeft: Record<PlayerId, number>
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
  /** Build tool: next click targets a source to develop or re-aim. */
  developingSource: boolean
  /** Empty hex waiting for the factory's direction arrow. */
  buildAimHex: Axial | null
  /** Fee placed on the next factory built. 0–10. */
  draftFee: number
  /** Flying chip waiting for a fee, a redirect, or a nuclear color. */
  pendingHit: PendingHit | null
  /** Player who must close factories before upkeep can be paid. */
  upkeepPlayer: PlayerId | null
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
  setDevelopingSource: () => void
  /** Pay 1 to claim a source (ship on it) or re-aim one you own in range. */
  developSource: (hex: Axial, dir: DirIndex) => void
  /** Pay 1 to turn your own factory while the ship is on it or next to it. */
  aimFactory: (hex: Axial, dir: DirIndex) => void
  /** Empty hex under the ship: wait for the build arrow before paying. */
  armFactoryBuild: (hex: Axial) => void
  setDraftFee: (fee: number) => void
  /** Bauaktion 6. Ship on your factory, 1 action point, no money. */
  setFactoryFee: (hex: Axial, fee: number) => void
  /** Pay the posted fee and run the non-destructive effect, or trigger under a ship. */
  confirmFactoryHit: () => void
  /** Leave a non-destructive factory effect unpaid. The chip keeps its direction. */
  declineFactoryHit: () => void
  /** After paying an Atomkraftwerk, swap the uranium chip for heat of this color. */
  pickNuclearColor: (color: ChipColor) => void
  /** Speicher: owner, on their simulation turn, shoots the charge along the arrow. */
  releaseStorage: (hex: Axial) => void
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
  /** Pass the rest of this player's actions. Player 1 hands to player 2; player 2 just expires. */
  endActions: () => void
  seedSourcesForEmit: () => void
  adjustMeter: (hex: Axial, meter: MeterKind, delta: number) => void
  rollDice: () => DirIndex
  drawFromBag: () => ChipColor
  placeField: (hex: Axial, kind: FieldKind, owner: PlayerId, dir?: DirIndex) => void
  removeField: (hex: Axial) => void
  /** Remove-tool: Chip / Feld / Verbraucher / Ladung auf Hex entfernen. */
  removeAt: (hex: Axial) => void
  /** Round start: close one of your factories until upkeep is affordable. */
  closeForUpkeep: (hex: Axial) => void
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

const ACTIONS_PER_PLAYER = 4

function freshActions(): Record<PlayerId, number> {
  return { 1: ACTIONS_PER_PLAYER, 2: ACTIONS_PER_PLAYER }
}

type ActionSpend =
  | {
      ok: true
      actionsLeft: Record<PlayerId, number>
      activePlayer: PlayerId
      note: string
    }
  | { ok: false; message: string }

function beginAction(s: Snapshot): ActionSpend {
  if (s.phase !== 'act') {
    return { ok: false, message: 'Aktionen nur in der Aktionsphase.' }
  }
  const p = s.activePlayer
  const left = s.actionsLeft[p] ?? 0
  if (left <= 0) {
    return {
      ok: false,
      message: `${playerLabel(p)} hat keine Aktionspunkte mehr.`,
    }
  }
  const remaining = left - 1
  const actionsLeft = { ...s.actionsLeft, [p]: remaining }
  const next = nextClockwise(p)
  if (remaining === 0 && (actionsLeft[next] ?? 0) > 0) {
    return {
      ok: true,
      actionsLeft,
      activePlayer: next,
      note: `Aktionspunkt verbraucht (0 übrig). → ${playerLabel(next)}`,
    }
  }
  return {
    ok: true,
    actionsLeft,
    activePlayer: p,
    note: `Aktionspunkt verbraucht (${remaining} übrig).`,
  }
}

function spentFields(
  s: Snapshot,
  spent: Extract<ActionSpend, { ok: true }>,
): Partial<Snapshot> {
  const handoff = spent.activePlayer !== s.activePlayer
  return {
    actionsLeft: spent.actionsLeft,
    activePlayer: spent.activePlayer,
    ...(handoff ? { developingSource: false, heldShip: null } : {}),
  }
}

function shipPickBlock(s: Snapshot, player: PlayerId): string | null {
  if (s.phase !== 'act') return 'Schiffe bewegen nur in der Aktionsphase.'
  if (player !== s.activePlayer) return `${playerLabel(s.activePlayer)} ist am Zug.`
  if ((s.actionsLeft[player] ?? 0) <= 0) {
    return `${playerLabel(player)} hat keine Aktionspunkte mehr.`
  }
  return null
}

function applyShipStep(
  s: Snapshot,
  player: PlayerId,
  hex: Axial,
): Partial<Snapshot> {
  const key = hexKey(hex)
  const cell = s.cells[key]
  if (!cell) return { log: appendLog(s.log, s.day, 'Kein Feld.') }
  if (player !== s.activePlayer) {
    return {
      log: appendLog(s.log, s.day, `${playerLabel(s.activePlayer)} ist am Zug.`),
    }
  }
  if (hexEquals(s.ships[player], hex)) {
    return {
      heldShip: null,
      selectedHex: hex,
      log: appendLog(s.log, s.day, `Schiff ${playerLabel(player)} abgelegt.`),
    }
  }
  if (hexDistance(s.ships[player], hex) !== 1) {
    return {
      log: appendLog(s.log, s.day, 'Ein Schritt nur auf ein Nachbarfeld.'),
    }
  }
  if (!cell.revealed) {
    return {
      log: appendLog(s.log, s.day, 'Unentdecktes Feld — nicht begehbar.'),
    }
  }
  const other: PlayerId = player === 1 ? 2 : 1
  if (hexEquals(s.ships[other], hex)) {
    return {
      log: appendLog(s.log, s.day, 'Feld vom anderen Raumschiff besetzt.'),
    }
  }
  const spent = beginAction(s)
  if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }

  const around = revealAroundShip(
    s.cells,
    s.landscapeDecks,
    s.planetNames,
    hex,
  )
  let log = appendLog(
    s.log,
    s.day,
    `${playerLabel(player)} geht nach (${hex.q},${hex.r}). ${spent.note}`,
  )
  if (around.revealed.length > 0) {
    log = appendLog(log, s.day, `Auto-Erkundung: ${around.revealed.join(' · ')}`)
  }
  if (SOURCE_TERRAINS.has(cell.terrain)) {
    const note = sourceVisitNote(around.cells[key] ?? cell)
    if (note) log = appendLog(log, s.day, note)
  }
  return {
    ships: { ...s.ships, [player]: { ...hex } },
    cells: around.cells,
    landscapeDecks: around.decks,
    planetNames: around.planetNames,
    ...spentFields(s, spent),
    heldShip: null,
    selectedChipId: null,
    selectedHex: hex,
    log,
  }
}

function expireActionsLog(s: Snapshot, log: string[]): string[] {
  if (s.phase !== 'act') return log
  const leftover = ([1, 2] as PlayerId[])
    .filter((p) => (s.actionsLeft[p] ?? 0) > 0)
    .map((p) => `${playerLabel(p)} ${s.actionsLeft[p]}`)
  if (leftover.length === 0) return log
  return appendLog(
    log,
    s.day,
    `Aktionspunkte verfallen: ${leftover.join(', ')}.`,
  )
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
    landscapeDecks: s.landscapeDecks,
    planetNames: s.planetNames,
    actionsLeft: s.actionsLeft,
    bank: s.bank,
    orderHolder: s.orderHolder,
    selectedHex: s.selectedHex,
    selectedChipId: s.selectedChipId,
    heldShip: s.heldShip,
    tool: s.tool,
    placeKind: s.placeKind,
    approveType: s.approveType,
    developingSource: s.developingSource,
    buildAimHex: s.buildAimHex,
    draftFee: s.draftFee,
    pendingHit: s.pendingHit,
    upkeepPlayer: s.upkeepPlayer,
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
  const startingPlayers = {
    1: { money: START_MONEY, owed: 0 },
    2: { money: START_MONEY, owed: 0 },
  }
  const startingBank = BANK_START - START_MONEY * 2
  const demand = runDemandRoll(
    board.cells,
    1,
    setupLog,
    startingPlayers,
    startingBank,
  )
  const emitted = emitRevealedSources(demand.cells, 1, demand.log)
  return {
    day: 1,
    phase: 'order',
    activePlayer: 1,
    players: demand.players,
    cells: emitted.cells,
    chips: [],
    ships: {
      1: { ...SHIP_SPAWNS[1] },
      2: { ...SHIP_SPAWNS[2] },
    },
    landscapeDecks: board.landscapeDecks,
    planetNames: board.planetNames,
    actionsLeft: freshActions(),
    bank: demand.bank,
    orderHolder: 1,
    selectedHex: null,
    selectedChipId: null,
    heldShip: null,
    tool: 'select',
    placeKind: 'divert',
    approveType: null,
    developingSource: false,
    buildAimHex: null,
    draftFee: 0,
    pendingHit: null,
    upkeepPlayer: null,
    lastDice: null,
    log: emitted.log.slice(0, 80),
    lost: false,
    lossReason: null,
    gameOver: false,
    winner: null,
  }
}

function migrateActions(state: {
  phase: string
  activePlayer: PlayerId
  orderHolder?: PlayerId
  actionsLeft?: Record<PlayerId, number>
}) {
  const legacy =
    state.phase === 'navigate' ||
    state.phase === 'build' ||
    state.phase === 'demand'
  state.phase = normalizePhase(state.phase)
  if (
    !state.actionsLeft ||
    state.actionsLeft[1] == null ||
    state.actionsLeft[2] == null
  ) {
    state.actionsLeft = freshActions()
  }
  if (legacy && state.phase === 'act') {
    state.activePlayer = state.orderHolder ?? 1
    state.actionsLeft = freshActions()
  }
  // Action phase used to start on Weiß. If nobody has spent a point yet,
  // give the turn to the order-chip holder.
  if (
    state.phase === 'act' &&
    state.orderHolder &&
    state.activePlayer !== state.orderHolder &&
    state.actionsLeft[1] === ACTIONS_PER_PLAYER &&
    state.actionsLeft[2] === ACTIONS_PER_PLAYER
  ) {
    state.activePlayer = state.orderHolder
  }
}

function normalizePhase(phase: string): PhaseId {
  if (phase === 'demand' || phase === 'navigate' || phase === 'build') return 'act'
  if (phase === 'emit') return 'simulate'
  if (phase === 'end') return 'order'
  if (phase === 'order' || phase === 'act' || phase === 'simulate') {
    return phase
  }
  return 'order'
}

function appendLog(log: string[], day: number, msg: string): string[] {
  return [`T${day}: ${msg}`, ...log].slice(0, 80)
}

function runDemandRoll(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
  players: Record<PlayerId, PlayerState>,
  bank: number,
): {
  cells: Record<string, CellState>
  log: string[]
  players: Record<PlayerId, PlayerState>
  bank: number
} {
  let nextCells = { ...cells }
  let nextLog = log
  let nextPlayers = players
  let nextBank = bank
  const parts: string[] = []
  const bonuses: { owner: PlayerId; name: string; count: number }[] = []

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
    let plus = 0
    const planet = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
    for (const cons of cell.consumers) {
      const roll = rollW4()
      if (cons.type === 'voltage') voltage += roll
      else if (cons.type === 'water') water += roll
      else heat += roll
      if (roll === 1) plus += 1
      parts.push(`${planet} ${METER_LABELS[cons.type]} ${formatMeterDelta(roll)}`)
    }
    nextCells[key] = { ...cell, voltage, water, heat }
    if (plus > 0 && cell.planetOwner) {
      bonuses.push({ owner: cell.planetOwner, name: planet, count: plus })
    }
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

  for (const bonus of bonuses) {
    const earned = earnFromBank(nextPlayers, nextBank, bonus.owner, bonus.count)
    nextPlayers = earned.players
    nextBank = earned.bank
    nextLog = appendLog(
      nextLog,
      day,
      `${bonus.name}: ${bonus.count}× +1, ${playerLabel(bonus.owner)} +${bonus.count} Geld${earned.owedNote}.`,
    )
  }

  return {
    cells: nextCells,
    log: nextLog,
    players: nextPlayers,
    bank: nextBank,
  }
}

function applyPhaseEntry(
  s: Snapshot,
  phase: PhaseId,
  day: number,
  log: string[],
): Partial<Snapshot> {
  let cells = s.cells
  let players = s.players
  let bank = s.bank
  let actionsLeft = s.actionsLeft
  let orderHolder = s.orderHolder
  let activePlayer = s.activePlayer
  let gameOver = s.gameOver
  let winner = s.winner
  let nextLog = log
  let upkeepPlayer: PlayerId | null = null

  if (phase === 'order') {
    if (bank <= 0) {
      gameOver = true
      winner = decideWinner(players)
      const reason =
        winner === 'draw'
          ? 'Geldstapel leer — Gleichstand, Gewinn als Team.'
          : `Geldstapel leer — ${playerLabel(winner)} gewinnt.`
      nextLog = appendLog(nextLog, day, reason)
    } else {
      const who = firstWhoMustClose(players, cells, s.orderHolder)
      if (who) {
        upkeepPlayer = who
        activePlayer = who
        nextLog = appendLog(nextLog, day, closurePrompt(who, players, cells))
      } else {
        const done = finishOrderStart(s, cells, players, bank, day, nextLog)
        cells = done.cells ?? cells
        players = done.players ?? players
        bank = done.bank ?? bank
        nextLog = done.log ?? nextLog
        orderHolder = done.orderHolder ?? orderHolder
        activePlayer = done.activePlayer ?? activePlayer
      }
    }
  }

  if (phase === 'act') {
    actionsLeft = freshActions()
    activePlayer = s.orderHolder
    const second = nextClockwise(s.orderHolder)
    nextLog = appendLog(
      nextLog,
      day,
      `Aktionsphase: ${playerLabel(s.orderHolder)} hat ${ACTIONS_PER_PLAYER} Aktionen, danach ${playerLabel(second)}. Ungenutzte Punkte verfallen.`,
    )
  }

  if (phase === 'simulate') {
    activePlayer = s.orderHolder
  }

  return {
    cells,
    players,
    bank,
    log: nextLog,
    actionsLeft,
    orderHolder,
    activePlayer,
    gameOver,
    winner,
    upkeepPlayer,
  }
}

function factoryCount(
  cells: Record<string, CellState>,
  player: PlayerId,
): number {
  let count = 0
  for (const cell of Object.values(cells)) {
    if (cell.field?.owner === player) count += 1
  }
  return count
}

function mustCloseFactories(
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
  player: PlayerId,
): boolean {
  return factoryCount(cells, player) > players[player].money
}

/** Order-chip holder first, then the other player. */
function firstWhoMustClose(
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
  start: PlayerId,
): PlayerId | null {
  if (mustCloseFactories(players, cells, start)) return start
  const other = nextClockwise(start)
  if (mustCloseFactories(players, cells, other)) return other
  return null
}

function closurePrompt(
  player: PlayerId,
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
): string {
  const count = factoryCount(cells, player)
  const money = players[player].money
  const extra = count - money
  return `${playerLabel(player)} kann ${money} von ${count} Fabriken unterhalten. Schließe ${extra} ${extra === 1 ? 'Fabrik' : 'Fabriken'}.`
}

/** Pay full upkeep, then colonies, order chip, demand and emission. */
function finishOrderStart(
  s: Snapshot,
  cells: Record<string, CellState>,
  players: Record<PlayerId, PlayerState>,
  bank: number,
  day: number,
  log: string[],
): Partial<Snapshot> {
  const upkeep = payFactoryUpkeep(players, cells, bank, day, log)
  const destroyed = applyColonyDestruction(cells, day, upkeep.log)
  const orderHolder = assignOrderChip(upkeep.players, s.orderHolder)
  let nextLog = appendLog(
    destroyed.log,
    day,
    `Reihenfolgechip: ${playerLabel(orderHolder)} beginnt.`,
  )
  const rolled = runDemandRoll(
    destroyed.cells,
    day,
    nextLog,
    upkeep.players,
    upkeep.bank,
  )
  const emitted = emitRevealedSources(rolled.cells, day, rolled.log)
  return {
    cells: emitted.cells,
    players: rolled.players,
    bank: rolled.bank,
    log: emitted.log,
    orderHolder,
    activePlayer: orderHolder,
    upkeepPlayer: null,
  }
}

/** 1 Geld pro eigener Fabrik an die Bank. Jeder Spieler kann den vollen Betrag zahlen. */
function payFactoryUpkeep(
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
  bank: number,
  day: number,
  log: string[],
): { players: Record<PlayerId, PlayerState>; bank: number; log: string[] } {
  const due: Record<PlayerId, number> = { 1: 0, 2: 0 }
  for (const cell of Object.values(cells)) {
    if (cell.field) due[cell.field.owner] += 1
  }
  let next = players
  let nextBank = bank
  let nextLog = log
  for (const player of [1, 2] as PlayerId[]) {
    const count = due[player]
    if (count === 0 || next[player].money < count) continue
    next = {
      ...next,
      [player]: { ...next[player], money: next[player].money - count },
    }
    nextBank += count
    nextLog = appendLog(
      nextLog,
      day,
      `${playerLabel(player)} zahlt ${count} Fabrikunterhalt für ${count} ${count === 1 ? 'Fabrik' : 'Fabriken'}.`,
    )
  }
  return { players: next, bank: nextBank, log: nextLog }
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
            developingSource: tool === 'place' ? get().developingSource : false,
            buildAimHex: null,
          }),
        setPlaceKind: (placeKind) =>
          setUi({
            placeKind,
            approveType: null,
            developingSource: false,
            buildAimHex: null,
            tool: 'place',
            heldShip: null,
            selectedChipId: null,
          }),
        setApproveType: (approveType) =>
          setUi({
            approveType,
            developingSource: false,
            buildAimHex: null,
            tool: 'place',
            heldShip: null,
            selectedChipId: null,
          }),
        setDevelopingSource: () =>
          setUi({
            developingSource: true,
            approveType: null,
            buildAimHex: null,
            tool: 'place',
            heldShip: null,
            selectedChipId: null,
          }),
        selectHex: (selectedHex) => setUi({ selectedHex }),
        selectChip: (selectedChipId) =>
          setUi({ selectedChipId, heldShip: null }),

        setPhase: (phase) => {
          commit((s) => {
            if (s.upkeepPlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zuerst Fabriken schließen, bis der Unterhalt bezahlbar ist.',
                ),
              }
            }
            if (s.phase === phase || s.gameOver) return null
            const log = expireActionsLog(s, s.log)
            const entered = applyPhaseEntry(s, phase, s.day, log)
            return {
              phase,
              ...entered,
              heldShip: null,
              selectedChipId: phase === 'simulate' ? s.selectedChipId : null,
              developingSource: false,
              buildAimHex: null,
              pendingHit: null,
              tool: 'select',
            }
          })
        },

        nextPhase: () => {
          commit((s) => {
            if (s.upkeepPlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zuerst Fabriken schließen, bis der Unterhalt bezahlbar ist.',
                ),
              }
            }
            if (s.gameOver) return null
            const i = PHASES.findIndex((p) => p.id === s.phase)
            const next = PHASES[(i + 1) % PHASES.length]
            let day = s.day
            let log = appendLog(s.log, s.day, `Phase → ${next.label}`)
            log = expireActionsLog(s, log)

            if (next.id === 'order' && s.phase === 'simulate') {
              day = s.day + 1
              log = appendLog(log, day, `Tag ${day} beginnt.`)
            }

            const entered = applyPhaseEntry({ ...s, day }, next.id, day, log)
            return {
              phase: next.id,
              day,
              ...entered,
              heldShip: null,
              selectedChipId: next.id === 'simulate' ? null : s.selectedChipId,
              developingSource: false,
              buildAimHex: null,
              pendingHit: null,
              tool: 'select',
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
            const rolled = runDemandRoll(
              s.cells,
              s.day,
              s.log,
              s.players,
              s.bank,
            )
            return {
              cells: rolled.cells,
              log: rolled.log,
              players: rolled.players,
              bank: rolled.bank,
            }
          })
        },

        selectAt: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell) return null

            if (s.heldShip != null) {
              return applyShipStep(s, s.heldShip, hex)
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
              return transferChip(s, held, hex, 'drop')
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
              const color = cell.field.charge[0]
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
                      charge: cell.field.charge.slice(1),
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
              const color = cell.sourceStock[0]
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
                    sourceStock: cell.sourceStock.slice(1),
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
              const block = shipPickBlock(s, shipHere)
              if (block) {
                return {
                  selectedHex: hex,
                  log: appendLog(s.log, s.day, block),
                }
              }
              return {
                heldShip: shipHere,
                selectedChipId: null,
                selectedHex: hex,
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
            const block = shipPickBlock(s, player)
            if (block) return { log: appendLog(s.log, s.day, block) }
            const hex = s.ships[player]
            return {
              heldShip: player,
              selectedChipId: null,
              selectedHex: { ...hex },
              log: appendLog(
                s.log,
                s.day,
                `Schiff ${playerLabel(player)} aufgenommen. Zielhex klicken.`,
              ),
            }
          })
        },

        moveShip: (hex, player) => {
          commit((s) => applyShipStep(s, player ?? s.activePlayer, hex))
        },

        endActions: () => {
          commit((s) => {
            if (s.phase !== 'act') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Aktionen beenden nur in der Aktionsphase.',
                ),
              }
            }
            const p = s.activePlayer
            const next = nextClockwise(p)
            const left = s.actionsLeft[p] ?? 0
            const expired =
              left === 1
                ? '1 Aktionspunkt verfällt'
                : `${left} Aktionspunkte verfallen`
            if ((s.actionsLeft[next] ?? 0) > 0) {
              return {
                actionsLeft: { ...s.actionsLeft, [p]: 0 },
                activePlayer: next,
                heldShip: null,
                developingSource: false,
                log: appendLog(
                  s.log,
                  s.day,
                  left > 0
                    ? `${playerLabel(p)} beendet die Aktionen. ${expired}. → ${playerLabel(next)}`
                    : `${playerLabel(p)} ist fertig. → ${playerLabel(next)}`,
                ),
              }
            }
            if (left <= 0) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `${playerLabel(p)} hat keine Aktionspunkte mehr. Weiter zur Simulation.`,
                ),
              }
            }
            return {
              actionsLeft: { ...s.actionsLeft, [p]: 0 },
              heldShip: null,
              developingSource: false,
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(p)} beendet die Aktionen. ${expired}.`,
              ),
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
              s.landscapeDecks,
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
              landscapeDecks: around.decks,
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
            if (!inShipRange(s.ships[owner], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Verbraucher nur, wenn das Schiff auf dem Planeten oder daneben steht.',
                ),
              }
            }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }

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
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(owner)} genehmigt ${METER_LABELS[type]}-Verbraucher auf ${cell.planetName ?? `(${hex.q},${hex.r})`} — Planet gehört ${playerLabel(owner)}. ${spent.note}`,
              ),
            }
          })
        },

        seedSourcesForEmit: () => {
          commit((s) => {
            const count = Object.values(s.cells).filter(isDevelopedSource).length
            const msg =
              count === 0
                ? 'Emit: keine erschlossene Quelle.'
                : `Emit: ${count} erschlossene Quelle(n) erhalten je 1 zufälligen Chip.`
            return {
              cells: seedSourceCharges(s.cells),
              log: appendLog(s.log, s.day, msg),
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
          commit((s) => {
            const chip = s.selectedChipId
              ? s.chips.find(
                  (c) => c.id === s.selectedChipId && c.state === 'flying',
                )
              : undefined
            return {
              lastDice: dir,
              chips: chip
                ? s.chips.map((c) =>
                    c.id === chip.id ? { ...c, dir, dieStep: true } : c,
                  )
                : s.chips,
              log: appendLog(
                s.log,
                s.day,
                chip
                  ? `Würfel: ${dir} — nächster Schritt von (${chip.hex.q},${chip.hex.r}).`
                  : `Würfel: ${dir}`,
              ),
            }
          })
          return dir
        },

        drawFromBag: () => {
          const color = randomColor()
          setUi((s) => ({
            log: appendLog(s.log, s.day, `Beutel: ${color}`),
          }))
          return color
        },

        armFactoryBuild: (hex) => {
          commit((s) => {
            const cell = s.cells[hexKey(hex)]
            const player = s.activePlayer
            const def = FIELD_DEFS[s.placeKind]
            if (s.phase !== 'act') {
              return {
                log: appendLog(s.log, s.day, 'Bauen nur in der Aktionsphase.'),
              }
            }
            if (!cell?.revealed || cell.terrain !== 'empty' || cell.field) {
              return {
                buildAimHex: null,
                log: appendLog(s.log, s.day, 'Nur leere Felder bebauen.'),
              }
            }
            if (!inShipRange(s.ships[player], hex)) {
              return {
                buildAimHex: null,
                log: appendLog(
                  s.log,
                  s.day,
                  'Zum Bauen muss das Schiff auf dem Feld oder daneben stehen.',
                ),
              }
            }
            if ((s.actionsLeft[player] ?? 0) <= 0) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `${playerLabel(player)} hat keine Aktionspunkte mehr.`,
                ),
              }
            }
            if (s.players[player].money < def.cost) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Nicht genug Geld (${def.cost}) für ${def.name}.`,
                ),
              }
            }
            return {
              buildAimHex: { ...hex },
              selectedHex: { ...hex },
              log: appendLog(
                s.log,
                s.day,
                `Pfeil für ${def.name} auf (${hex.q},${hex.r}) wählen.`,
              ),
            }
          })
        },

        placeField: (hex, kind, owner, dir) => {
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
            if (recharging && cell.field && cell.field.owner !== owner) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Nur ${playerLabel(cell.field.owner)} kann den Trafo nachladen.`,
                ),
              }
            }
            if (!recharging && dir == null) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `${def.name} braucht einen Richtungspfeil.`,
                ),
              }
            }
            if (owner !== s.activePlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `${playerLabel(s.activePlayer)} ist am Zug.`,
                ),
              }
            }
            if (!inShipRange(s.ships[owner], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zum Bauen muss das Schiff auf dem Feld oder daneben stehen.',
                ),
              }
            }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
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
            const verb = recharging ? 'lädt' : 'baut'
            const fee = recharging
              ? clampFee(cell.field?.fee ?? 0)
              : clampFee(s.draftFee)
            const aimNote =
              !recharging && dir != null
                ? ` Pfeil ${dir} ${DIRECTIONS[dir - 1].label}. Gebühr ${fee}.`
                : ''
            return {
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  field: {
                    kind,
                    owner: recharging && cell.field ? cell.field.owner : owner,
                    charge,
                    dir: recharging ? cell.field?.dir : dir,
                    fee,
                    chargeResource: recharging
                      ? cell.field?.chargeResource
                      : undefined,
                  },
                },
              },
              players: paid.players,
              bank: paid.bank,
              buildAimHex: null,
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(owner)} ${verb} ${def.name} auf (${hex.q},${hex.r}) für ${def.cost} Geld.${aimNote} ${spent.note}`,
              ),
            }
          })
        },

        aimFactory: (hex, dir) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            const player = s.activePlayer
            if (!cell?.revealed || !cell.field) {
              return {
                log: appendLog(s.log, s.day, 'Keine Fabrik auf diesem Feld.'),
              }
            }
            if (cell.field.owner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Fabrik gehört ${playerLabel(cell.field.owner)}.`,
                ),
              }
            }
            if (!inShipRange(s.ships[player], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zum Ausrichten muss das Schiff auf der Fabrik oder daneben stehen.',
                ),
              }
            }
            if (cell.field.dir === dir) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Fabrik zeigt bereits in diese Richtung.',
                ),
              }
            }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
            const paid = payToBank(s.players, s.bank, player, 1)
            if (!paid) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Nicht genug Geld (1) zum Ausrichten.',
                ),
              }
            }
            const aim = DIRECTIONS[dir - 1].label
            const name = FIELD_DEFS[cell.field.kind].name
            return {
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  field: { ...cell.field, dir },
                },
              },
              players: paid.players,
              bank: paid.bank,
              developingSource: false,
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(player)} dreht ${name} (${hex.q},${hex.r}) auf Richtung ${dir} ${aim} für 1 Geld. ${spent.note}`,
              ),
            }
          })
        },

        setDraftFee: (fee) => setUi({ draftFee: clampFee(fee) }),

        setFactoryFee: (hex, fee) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            const player = s.activePlayer
            const next = clampFee(fee)
            if (!cell?.revealed || !cell.field) {
              return { log: appendLog(s.log, s.day, 'Keine Fabrik auf diesem Feld.') }
            }
            if (cell.field.owner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Fabrik gehört ${playerLabel(cell.field.owner)}.`,
                ),
              }
            }
            if (!inShipRange(s.ships[player], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zum Ändern der Gebühr muss das Schiff auf der Fabrik oder daneben stehen.',
                ),
              }
            }
            if (clampFee(cell.field.fee ?? 0) === next) {
              return {
                log: appendLog(s.log, s.day, `Gebühr ist bereits ${next}.`),
              }
            }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
            const name = FIELD_DEFS[cell.field.kind].name
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, field: { ...cell.field, fee: next } },
              },
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(player)} setzt die Gebühr von ${name} (${hex.q},${hex.r}) auf ${next}. ${spent.note}`,
              ),
            }
          })
        },

        confirmFactoryHit: () => {
          commit((s) => {
            const pending = s.pendingHit
            if (!pending) {
              return { log: appendLog(s.log, s.day, 'Nichts auszulösen.') }
            }
            const chip = s.chips.find(
              (c) => c.id === pending.chipId && c.state === 'flying',
            )
            const cell = s.cells[hexKey(pending.hex)]
            if (!chip || !cell?.revealed) {
              return {
                pendingHit: null,
                log: appendLog(s.log, s.day, 'Der Treffer ist nicht mehr da.'),
              }
            }
            if (pending.mode === 'color') {
              return {
                log: appendLog(s.log, s.day, 'Farbe für die Wärme wählen.'),
              }
            }
            if (pending.mode === 'ship') {
              if (cell.field) {
                const kind = classifyFactoryHit(cell.field, chip)
                if (kind === 'straight') {
                  return {
                    pendingHit: null,
                    log: appendLog(
                      s.log,
                      s.day,
                      `${FIELD_DEFS[cell.field.kind].name}: keine Interaktion — geradeaus.`,
                    ),
                  }
                }
                const payer = chipPilot(chip, s.activePlayer)
                const fee = clampFee(cell.field.fee ?? 0)
                if (!canAffordFee(s.players, payer, cell.field.owner, fee)) {
                  return {
                    pendingHit: null,
                    log: appendLog(
                      s.log,
                      s.day,
                      `Gebühr ${fee} nicht bezahlbar — Chip fliegt geradeaus.`,
                    ),
                  }
                }
                const applied = applyPaidFactory(s, chip, cell, pending.hex)
                return departIfFlying(s, applied, chip.id)
              }
              if (cell.terrain === 'planet') {
                const impact = planetImpact(s, chip, cell)
                if (!impact) {
                  return {
                    pendingHit: null,
                    log: appendLog(
                      s.log,
                      s.day,
                      'Planet: Chip braucht Spannung, Wasser, Wärme, Uran oder Licht.',
                    ),
                  }
                }
                return { ...impact, pendingHit: null }
              }
              return { pendingHit: null }
            }
            if (!cell.field) {
              return {
                pendingHit: null,
                log: appendLog(s.log, s.day, 'Keine Fabrik mehr auf dem Feld.'),
              }
            }
            const applied = applyPaidFactory(s, chip, cell, pending.hex)
            return departIfFlying(s, applied, chip.id)
          })
        },

        declineFactoryHit: () => {
          commit((s) => {
            const pending = s.pendingHit
            if (pending?.mode !== 'fee') {
              return {
                log: appendLog(s.log, s.day, 'Keine Gebühr offen.'),
              }
            }
            const chip = s.chips.find((c) => c.id === pending.chipId)
            const cleared: Snapshot = {
              ...s,
              pendingHit: null,
              log: appendLog(
                s.log,
                s.day,
                'Gebühr nicht gezahlt — Chip fliegt geradeaus weiter.',
              ),
            }
            if (!chip?.dir || chip.state !== 'flying') return cleared
            return transferChip(cleared, chip, neighbor(chip.hex, chip.dir), 'step')
          })
        },

        pickNuclearColor: (color) => {
          commit((s) => {
            const pending = s.pendingHit
            if (pending?.mode !== 'color') {
              return { log: appendLog(s.log, s.day, 'Keine Farbe zu wählen.') }
            }
            const cell = s.cells[hexKey(pending.hex)]
            const chip = s.chips.find((c) => c.id === pending.chipId)
            const dir = cell?.field?.dir ?? chip?.dir
            if (!chip || !dir) {
              return {
                pendingHit: null,
                log: appendLog(s.log, s.day, 'Atomkraftwerk hat keinen Pfeil mehr.'),
              }
            }
            const aim = DIRECTIONS[dir - 1].label
            const heated = s.chips.map((c) =>
              c.id === chip.id
                ? { ...flyOnto(c, pending.hex, dir, 'heat'), color }
                : c,
            )
            return departIfFlying(
              s,
              {
                chips: heated,
                pendingHit: null,
                selectedChipId: chip.id,
                log: appendLog(
                  s.log,
                  s.day,
                  `Atomkraftwerk: Uran wird Wärme ${color}, Pfeil ${dir} ${aim}.`,
                ),
              },
              chip.id,
            )
          })
        },

        releaseStorage: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            const player = s.activePlayer
            if (s.phase !== 'simulate') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Ladung abfeuern nur in der Simulation, und nur wenn der Besitzer dran ist.',
                ),
              }
            }
            if (!cell?.revealed || cell.field?.kind !== 'pumped') {
              return { log: appendLog(s.log, s.day, 'Kein Speicher auf diesem Feld.') }
            }
            if (cell.field.owner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Speicher gehört ${playerLabel(cell.field.owner)}.`,
                ),
              }
            }
            if (cell.field.charge.length === 0) {
              return { log: appendLog(s.log, s.day, 'Speicher ist leer.') }
            }
            if (cell.field.dir == null) {
              return { log: appendLog(s.log, s.day, 'Speicher hat keinen Pfeil.') }
            }
            const color = cell.field.charge[0]
            const resource = cell.field.chargeResource ?? 'water'
            const dir = cell.field.dir
            const chip: Chip = {
              id: uid('fly'),
              color,
              state: 'flying',
              hex: { ...hex },
              dir,
              resource,
              pilot: player,
              stepsLeft: 5,
            }
            return {
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  field: { ...cell.field, charge: [], chargeResource: undefined },
                },
              },
              chips: [...s.chips, chip],
              selectedChipId: chip.id,
              pendingHit: null,
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(player)} schießt ${resourceName(resource)} ${color} aus dem Speicher in Pfeilrichtung ${dir} ${DIRECTIONS[dir - 1].label}.`,
              ),
            }
          })
        },

        closeForUpkeep: (hex) => {
          commit((s) => {
            const player = s.upkeepPlayer
            if (!player) {
              return {
                log: appendLog(s.log, s.day, 'Niemand muss Fabriken schließen.'),
              }
            }
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell?.field || cell.field.owner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `${playerLabel(player)} schließt nur eigene Fabriken.`,
                ),
              }
            }
            const name = FIELD_DEFS[cell.field.kind].name
            const charges = cell.field.charge.length
            const cells = {
              ...s.cells,
              [key]: { ...cell, field: undefined },
            }
            let log = appendLog(
              s.log,
              s.day,
              `${playerLabel(player)} schließt ${name} (${hex.q},${hex.r}). Fabrik und ${charges} Ladung zurück in die Box.`,
            )
            const who = firstWhoMustClose(s.players, cells, player)
            if (who) {
              log = appendLog(
                log,
                s.day,
                who === player
                  ? `Noch ${factoryCount(cells, player) - s.players[player].money} schließen.`
                  : closurePrompt(who, s.players, cells),
              )
              return { cells, log, upkeepPlayer: who, activePlayer: who }
            }
            return finishOrderStart(s, cells, s.players, s.bank, s.day, log)
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
              const player = s.activePlayer
              const name = FIELD_DEFS[cell.field.kind].name
              if (cell.field.owner !== player) {
                return {
                  log: appendLog(
                    s.log,
                    s.day,
                    `${name} gehört ${playerLabel(cell.field.owner)}.`,
                  ),
                }
              }
              if (!inShipRange(s.ships[player], hex)) {
                return {
                  log: appendLog(
                    s.log,
                    s.day,
                    'Zum Abbauen muss das Schiff auf der Fabrik oder daneben stehen.',
                  ),
                }
              }
              const spent = beginAction(s)
              if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
              const charges = cell.field.charge.length
              const pending =
                s.pendingHit && hexEquals(s.pendingHit.hex, hex)
                  ? null
                  : s.pendingHit
              return {
                cells: {
                  ...s.cells,
                  [key]: { ...cell, field: undefined },
                },
                pendingHit: pending,
                ...spentFields(s, spent),
                log: appendLog(
                  s.log,
                  s.day,
                  `${playerLabel(player)} baut ${name} (${hex.q},${hex.r}) ab. Fabrik und ${charges} Ladung zurück in die Box. ${spent.note}`,
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
            if (
              SOURCE_TERRAINS.has(cell.terrain) &&
              (cell.sourceOwner != null || cell.sourceDir != null)
            ) {
              return {
                cells: {
                  ...s.cells,
                  [key]: {
                    ...cell,
                    sourceOwner: undefined,
                    sourceDir: undefined,
                  },
                },
                log: appendLog(
                  s.log,
                  s.day,
                  `Erschließung entfernt (${hex.q},${hex.r}).`,
                ),
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
              pilot: s.activePlayer,
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
              return transferChip(s, held, hex, 'drop')
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
              const color = cell.field.charge[0]
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
                      charge: cell.field.charge.slice(1),
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
              const color = cell.sourceStock[0]
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
                    sourceStock: cell.sourceStock.slice(1),
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
            if (!chip || chip.state !== 'flying') return null
            if (s.pendingHit?.chipId === chipId) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Erst Auslösen, Gebühr oder Umleitung entscheiden.',
                ),
              }
            }
            if (!chip.dir) return null
            return transferChip(s, chip, neighbor(chip.hex, chip.dir), 'step')
          })
        },

        setChipDir: (chipId, dir) => {
          commit((s) => {
            const chip = s.chips.find((c) => c.id === chipId)
            if (!chip) return null
            const redirect =
              s.pendingHit?.mode === 'ship' && s.pendingHit.chipId === chipId
            const aimed: Chip = { ...chip, dir, dieStep: undefined }
            const next: Snapshot = {
              ...s,
              chips: s.chips.map((c) => (c.id === chipId ? aimed : c)),
              pendingHit: redirect ? null : s.pendingHit,
              log: redirect
                ? appendLog(
                    s.log,
                    s.day,
                    `Umleitung ohne Gebühr, Richtung ${dir} ${DIRECTIONS[dir - 1].label}.`,
                  )
                : s.log,
            }
            if (!redirect || aimed.state !== 'flying') return next
            return transferChip(next, aimed, neighbor(aimed.hex, dir), 'step')
          })
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
            const cell = s.cells[hexKey(chip.hex)]
            if (!cell || !cell.revealed || cell.terrain !== 'planet') {
              return {
                log: appendLog(s.log, s.day, 'Kein Planet unter dem Chip.'),
              }
            }

            const impact = planetImpact(s, chip, cell)
            if (!impact) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Chip braucht Ressource Spannung/Wasser/Wärme, Uran oder Licht.',
                ),
              }
            }
            return { ...impact, pendingHit: null }
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

            if (!cell.sourceOwner || cell.sourceDir == null) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Unerschlossene Quelle emittiert nicht.',
                ),
              }
            }

            const flyDir = dir ?? cell.sourceDir
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
              pilot: cell.sourceOwner,
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

        developSource: (hex, dir) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            const player = s.activePlayer
            if (!cell || !cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) {
              return {
                log: appendLog(s.log, s.day, 'Keine Quelle auf diesem Feld.'),
              }
            }
            const owner = cell.sourceOwner
            const claiming = owner == null
            if (owner != null && owner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Quelle gehört ${playerLabel(owner)}.`,
                ),
              }
            }
            if (!inShipRange(s.ships[player], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Das Schiff muss auf der Quelle oder daneben stehen.',
                ),
              }
            }
            if (!claiming && cell.sourceDir === dir) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Quelle zeigt bereits in diese Richtung.',
                ),
              }
            }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
            const paid = payToBank(s.players, s.bank, player, 1)
            if (!paid) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Nicht genug Geld (1) für die Quelle.',
                ),
              }
            }
            const aim = DIRECTIONS[dir - 1].label
            const name = LANDSCAPE_LABELS[cell.terrain as 'uranium' | 'sun' | 'water']
            return {
              cells: {
                ...s.cells,
                [key]: {
                  ...cell,
                  sourceOwner: player,
                  sourceDir: dir,
                },
              },
              players: paid.players,
              bank: paid.bank,
              ...spentFields(s, spent),
              developingSource: false,
              log: appendLog(
                s.log,
                s.day,
                claiming
                  ? `${playerLabel(player)} erschließt ${name} (${hex.q},${hex.r}) Richtung ${dir} ${aim} für 1 Geld. ${spent.note}`
                  : `${playerLabel(player)} dreht ${name} (${hex.q},${hex.r}) auf Richtung ${dir} ${aim} für 1 Geld. ${spent.note}`,
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
            const stayingSource =
              SOURCE_TERRAINS.has(terrain) && SOURCE_TERRAINS.has(cell.terrain)
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
                  sourceOwner: stayingSource ? cell.sourceOwner : undefined,
                  sourceDir: stayingSource ? cell.sourceDir : undefined,
                  sourceStock: stayingSource ? cell.sourceStock : [],
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
          state.tool !== 'remove' &&
          state.tool !== 'fee'
        ) {
          state.tool = 'select'
        }
        if (!state.ships) {
          state.ships = {
            1: { ...SHIP_SPAWNS[1] },
            2: { ...SHIP_SPAWNS[2] },
          }
        }
        if (!state.landscapeDecks) state.landscapeDecks = buildLandscapeDecks()
        if (!state.planetNames) state.planetNames = shufflePlanetNames()
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
        if (state.developingSource == null) state.developingSource = false
        if (state.buildAimHex === undefined) state.buildAimHex = null
        if (state.draftFee == null) state.draftFee = 0
        if (state.pendingHit === undefined) state.pendingHit = null
        if (state.upkeepPlayer === undefined) state.upkeepPlayer = null
        const wasEnd = (state.phase as string) === 'end'
        migrateActions(state)
        if (wasEnd && !state.gameOver) {
          const day = state.day + 1
          const log = appendLog(state.log, day, `Tag ${day} beginnt.`)
          const entered = applyPhaseEntry({ ...state, day }, 'order', day, log)
          Object.assign(state, entered, { phase: 'order' as PhaseId, day })
        }
        silenceUndevelopedSources(state.cells)
        for (const snap of state.past ?? []) {
          if (snap.developingSource == null) snap.developingSource = false
          if (snap.buildAimHex === undefined) snap.buildAimHex = null
          if (snap.draftFee == null) snap.draftFee = 0
          if (snap.pendingHit === undefined) snap.pendingHit = null
          if (snap.upkeepPlayer === undefined) snap.upkeepPlayer = null
          migrateActions(snap)
          silenceUndevelopedSources(snap.cells)
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
