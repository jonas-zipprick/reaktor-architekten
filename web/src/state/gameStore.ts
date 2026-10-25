import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  CONSUMER_COST,
  CRITICAL_LIMIT,
  EXTRACTOR_COST,
  FACTORY_UPKEEP,
  START_MONEY,
  TRAFO_RELOAD_COST,
} from '../data/boardLayout'
import {
  applySoloCoopStart,
  bankForPlayers,
  cellsFromScenario,
  getScenario,
  missionConsumersReady,
  missionPlanetStable,
  seatCountForMode,
  type ScenarioMission,
} from '../data/scenarios'
import {
  missionForDifficulty,
  type Difficulty,
} from '../data/difficulty'
import {
  describeFreibeuterPos,
  moveAllFreibeuter,
  spawnFreibeuter,
  type Freibeuter,
} from '../data/freibeuter'
import { FIELD_DEFS } from '../data/fields'
import {
  clampFee,
  classifyFactoryHit,
  departureKind,
  resourceName,
  rollDir,
  supplyPayout,
} from './factoryHit'
import {
  ROUTE_BUILD_COST,
  TIER_LABEL,
  upgradeCost,
} from './simRules'
import {
  abortTransport,
  clickDuringSim,
  deliverChip,
  passSimulation,
  releaseStoredChip,
  routeAlong,
  takeSourceChip,
  triggerFactory,
} from './simTurn'
import { METER_LABELS, METER_SHORT, playerLabel } from '../data/labels'
import {
  edgeKey,
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
  type DiscoveryOffer,
  type FieldKind,
  type GameMode,
  type LandscapeTerrain,
  type MeterKind,
  type PhaseId,
  type PendingHit,
  type PlacedField,
  type PlayerId,
  playerIdsForCount,
  type PlayerState,
  type Route,
  type RouteTier,
  type ToolMode,
  type Winner,
} from '../types'

const PHASES: { id: PhaseId; label: string; hint: string }[] = [
  {
    id: 'order',
    label: 'Rundenstart',
    hint: 'Leere Bank beendet das Spiel. Dann Quellen- und Planetenrebellionen, 2 Geld Unterhalt je Fabrik, Reihenfolgechip, Verbraucherwürfel ohne Geldbonus, danach ein Chip je Extraktor.',
  },
  {
    id: 'act',
    label: 'Aktionen',
    hint: 'Reihenfolgechip beginnt, jeder hat 4 Punkte. Schiff bewegen, Extraktor (2), Wege, Verbraucher und Trafo-Aufladen kosten Geld. Übernehmen nur mit dem Schiff auf dem Feld. Aufgeben, Gebühren und Geschenke kosten keine Punkte.',
  },
  {
    id: 'simulate',
    label: 'Simulation',
    hint: 'Reihenfolgechip beginnt. Ein Zug: einen Chip von einer Quelle nehmen oder die eigene Speicherladung freigeben, dann über Wege leiten. Effekt und Lieferung sind freiwillig. Zum dritten Mal auf demselben Feld ist der Chip weg. Ein voller Pass-Umlauf beendet die Phase.',
  },
]

export { PHASES }

const STORAGE_KEY = 'reaktor-playtest-v17'
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

function nextClockwise(p: PlayerId, seats: PlayerId[]): PlayerId {
  const i = seats.indexOf(p)
  if (i < 0) return seats[0] ?? 1
  return seats[(i + 1) % seats.length]!
}

/** Next seat clockwise that still has action points. */
function nextWithActions(
  from: PlayerId,
  seats: PlayerId[],
  actionsLeft: Record<PlayerId, number>,
): PlayerId | null {
  let p = nextClockwise(from, seats)
  for (let i = 0; i < seats.length; i++) {
    if ((actionsLeft[p] ?? 0) > 0) return p
    p = nextClockwise(p, seats)
  }
  return null
}

function playerScore(p: PlayerState): number {
  return p.money + (p.owed ?? 0)
}

function assignOrderChip(
  players: Record<PlayerId, PlayerState>,
  current: PlayerId,
  seats: PlayerId[],
): PlayerId {
  const min = Math.min(...seats.map((id) => players[id].money))
  const tied = seats.filter((id) => players[id].money === min)
  if (tied.length === 1) return tied[0]!
  let p = nextClockwise(current, seats)
  for (let i = 0; i < seats.length; i++) {
    if (tied.includes(p)) return p
    p = nextClockwise(p, seats)
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

const LANDSCAPE_LABELS: Record<LandscapeTerrain, string> = {
  empty: 'Leer',
  uranium: 'Uranquelle',
  sun: 'Sonnenquelle',
  water: 'Wasserquelle',
  mountain: 'Asteroid',
  planet: 'Planet',
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
  const name = FIELD_DEFS[field.kind].name
  if (field.owner == null) {
    return {
      ...landed,
      log: appendLog(
        landed.log ?? s.log,
        s.day,
        `${name} ist neutral und inaktiv.`,
      ),
    }
  }
  const kind = classifyFactoryHit(field, chip)
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
  if (field.owner == null) {
    return {
      log: appendLog(
        s.log,
        s.day,
        `${FIELD_DEFS[field.kind].name} ist neutral und inaktiv.`,
      ),
    }
  }
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

/** Offer a claim only for the neutral facility the ship is standing on. */
function standingClaim(player: PlayerId, cell: CellState): DiscoveryOffer | null {
  if (!cell.revealed) return null
  let label: string | null = null
  if (cell.field && cell.field.owner == null) {
    label = FIELD_DEFS[cell.field.kind].name
  } else if (cell.terrain === 'planet' && cell.planetOwner == null) {
    label = cell.planetName ?? 'Planet'
  } else if (SOURCE_TERRAINS.has(cell.terrain) && cell.sourceOwner == null) {
    label = LANDSCAPE_LABELS[cell.terrain as LandscapeTerrain]
  }
  if (!label) return null
  return {
    id: uid('offer'),
    player,
    hex: { ...cell.hex },
    label,
  }
}

function extractorCount(cell: CellState): number {
  return cell.extractors ?? 0
}

function neutralSource(cell: CellState): CellState {
  return {
    ...cell,
    sourceOwner: undefined,
    sourceFee: undefined,
    sourceDir: undefined,
    sourceStock: [],
    extractors: 0,
  }
}

function isProducingSource(cell: CellState): boolean {
  return (
    cell.revealed &&
    SOURCE_TERRAINS.has(cell.terrain) &&
    cell.sourceOwner != null &&
    extractorCount(cell) > 0
  )
}

function sourceVisitNote(cell: CellState): string | null {
  if (!cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) return null
  if (cell.sourceOwner != null) {
    const n = extractorCount(cell)
    return `Quelle von ${playerLabel(cell.sourceOwner)}. ${n} Extraktor${n === 1 ? '' : 'en'}, Lager ${cell.sourceStock.length}.`
  }
  return 'Neutrale Quelle — stillgelegt, ohne Extraktoren und ohne Lager.'
}

/** Drop dice-rolled arrows from saves made before sources had to be bought. */
function silenceUndevelopedSources(cells: Record<string, CellState> | undefined) {
  if (!cells) return
  for (const cell of Object.values(cells)) {
    if (cell.extractors == null) cell.extractors = 0
    if (!SOURCE_TERRAINS.has(cell.terrain) || cell.sourceOwner != null) continue
    cell.sourceDir = undefined
    cell.sourceFee = undefined
    cell.sourceStock = []
    cell.extractors = 0
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
    const n = isProducingSource(cell) ? extractorCount(cell) : 0
    if (n === 0) continue
    any = true
    const added: ChipColor[] = []
    for (let i = 0; i < n; i++) added.push(emittedSourceColor(cell.terrain))
    next[key] = {
      ...cell,
      sourceStock: [...cell.sourceStock, ...added],
    }
  }
  return any ? next : cells
}

function emitRevealedSources(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): { cells: Record<string, CellState>; log: string[] } {
  let chips = 0
  let idle = 0
  for (const cell of Object.values(cells)) {
    if (!cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) continue
    if (cell.sourceOwner == null) continue
    const n = extractorCount(cell)
    if (n === 0) idle += 1
    else chips += n
  }
  const msg =
    chips === 0
      ? idle === 0
        ? 'Produktion: keine Quelle mit Eigentümer.'
        : `Produktion: ${idle} Quelle(n) ohne Extraktor, kein Chip.`
      : `Produktion: ${chips} Chip(s)${idle > 0 ? `, ${idle} Quelle(n) ohne Extraktor` : ''}.`
  return {
    cells: seedSourceCharges(cells),
    log: appendLog(log, day, msg),
  }
}

function applySourceRebellions(
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): { cells: Record<string, CellState>; log: string[] } {
  let nextCells = cells
  let nextLog = log
  for (const [key, cell] of Object.entries(cells)) {
    if (!cell.revealed || !SOURCE_TERRAINS.has(cell.terrain)) continue
    if (cell.sourceOwner == null || cell.sourceStock.length < 5) continue
    if (nextCells === cells) nextCells = { ...cells }
    const owner = cell.sourceOwner
    const name = LANDSCAPE_LABELS[cell.terrain as 'sun' | 'water' | 'uranium']
    const extractors = extractorCount(cell)
    nextCells[key] = neutralSource(cell)
    nextLog = appendLog(
      nextLog,
      day,
      `${name} (${cell.hex.q},${cell.hex.r}): ${playerLabel(owner)} verliert die Quelle. ${extractors} Extraktoren und ${cell.sourceStock.length} Chips werden entfernt.`,
    )
  }
  return { cells: nextCells, log: nextLog }
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
    if (cell.terrain !== 'planet' || !cell.revealed) continue
    if (!meterCritical(cell)) continue
    if (nextCells === cells) nextCells = { ...cells }
    const n = cell.consumers.length
    const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
    nextCells[key] = {
      ...cell,
      consumers: [],
      planetOwner: undefined,
      importFee: undefined,
      voltage: 0,
      water: 0,
      heat: 0,
    }
    nextLog = appendLog(
      nextLog,
      day,
      `${name}: Rebellion (Messer ±${CRITICAL_LIMIT}${n > 0 ? `, ${n} Verbraucher` : ''}) — neutral, Messer auf 0.`,
    )
  }
  return { cells: nextCells, log: nextLog }
}

function freshFactory(field: PlacedField, owner: PlayerId): PlacedField {
  const def = FIELD_DEFS[field.kind]
  const charge: ChipColor[] = []
  for (let i = 0; i < def.startCharge; i++) charge.push(randomColor())
  return { kind: field.kind, owner, charge, fee: 0 }
}

function neutralizeFactory(field: PlacedField): PlacedField {
  return { kind: field.kind, owner: null, charge: [], fee: 0 }
}

function claimCell(
  cell: CellState,
  player: PlayerId,
): { cell: CellState; note: string } | { error: string } {
  if (cell.field) {
    if (cell.field.owner != null) {
      return { error: `Fabrik gehört ${playerLabel(cell.field.owner)}.` }
    }
    const next = freshFactory(cell.field, player)
    const loaded =
      next.charge.length > 0 ? `, Startladung ${next.charge.length}` : ''
    return {
      cell: { ...cell, field: next },
      note: `${playerLabel(player)} übernimmt ${FIELD_DEFS[cell.field.kind].name}${loaded}.`,
    }
  }
  if (cell.terrain === 'planet') {
    if (cell.planetOwner != null) {
      return { error: `Planet gehört ${playerLabel(cell.planetOwner)}.` }
    }
    const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
    return {
      cell: { ...cell, planetOwner: player },
      note: `${playerLabel(player)} übernimmt ${name}.`,
    }
  }
  if (SOURCE_TERRAINS.has(cell.terrain)) {
    if (cell.sourceOwner != null) {
      return { error: `Quelle gehört ${playerLabel(cell.sourceOwner)}.` }
    }
    return {
      cell: { ...cell, sourceOwner: player },
      note: `${playerLabel(player)} übernimmt ${LANDSCAPE_LABELS[cell.terrain as 'sun' | 'water' | 'uranium']}.`,
    }
  }
  return { error: 'Hier ist nichts zu übernehmen.' }
}

function abandonCell(
  cell: CellState,
  player: PlayerId,
): { cell: CellState; note: string } | { error: string } {
  if (cell.field) {
    if (cell.field.owner !== player) {
      return {
        error:
          cell.field.owner == null
            ? 'Fabrik ist schon neutral.'
            : `Fabrik gehört ${playerLabel(cell.field.owner)}.`,
      }
    }
    const charges = cell.field.charge.length
    return {
      cell: { ...cell, field: neutralizeFactory(cell.field) },
      note: `${playerLabel(player)} gibt ${FIELD_DEFS[cell.field.kind].name} auf. ${charges} Ladung in den Beutel.`,
    }
  }
  if (cell.terrain === 'planet') {
    if (cell.planetOwner !== player) {
      return {
        error:
          cell.planetOwner == null
            ? 'Planet ist schon neutral.'
            : `Planet gehört ${playerLabel(cell.planetOwner)}.`,
      }
    }
    const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
    return {
      cell: {
        ...cell,
        planetOwner: undefined,
        importFee: undefined,
        consumers: [],
        voltage: 0,
        water: 0,
        heat: 0,
      },
      note: `${playerLabel(player)} gibt ${name} auf. Verbraucher weg, Messer auf 0.`,
    }
  }
  if (SOURCE_TERRAINS.has(cell.terrain)) {
    if (cell.sourceOwner !== player) {
      return {
        error:
          cell.sourceOwner == null
            ? 'Quelle ist schon neutral.'
            : `Quelle gehört ${playerLabel(cell.sourceOwner)}.`,
      }
    }
    const chips = cell.sourceStock.length
    const extractors = extractorCount(cell)
    return {
      cell: neutralSource(cell),
      note: `${playerLabel(player)} gibt die Quelle auf. ${extractors} Extraktoren und ${chips} Chips werden entfernt.`,
    }
  }
  return { error: 'Hier ist nichts aufzugeben.' }
}

function decideWinner(
  players: Record<PlayerId, PlayerState>,
  seats: PlayerId[],
): Winner {
  let best: PlayerId | null = null
  let bestScore = -Infinity
  let tie = false
  for (const id of seats) {
    const score = playerScore(players[id])
    if (score > bestScore) {
      best = id
      bestScore = score
      tie = false
    } else if (score === bestScore) {
      tie = true
    }
  }
  if (tie || best == null) return 'draw'
  return best
}

function flightOpen(s: Snapshot): boolean {
  return s.chips.some((c) => c.state === 'flying') || s.simQueue.length > 0
}

function shipOnHex(
  ships: Record<PlayerId, Axial>,
  hex: Axial,
  seats?: PlayerId[],
): PlayerId | null {
  const ids = seats ?? (Object.keys(ships).map(Number) as PlayerId[])
  for (const id of ids) {
    const pos = ships[id]
    if (pos && hexEquals(pos, hex)) return id
  }
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
  /** Active seats for the chosen scenario. */
  playerIds: PlayerId[]
  scenarioId: string | null
  gameMode: GameMode
  difficulty: Difficulty
  freibeuters: Freibeuter[]
  piratePurse: number
  players: Record<PlayerId, PlayerState>
  cells: Record<string, CellState>
  chips: Chip[]
  ships: Record<PlayerId, Axial>
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
  /** Built transport links, keyed by undirected edge. */
  routes: Record<string, Route>
  /** Consecutive simulation passes. Two end the phase. */
  simPasses: number
  simDone: boolean
  /** Chips from the same factory effect, routed after the one in the air. */
  simQueue: string[]
  /** Player who must neutralize factories before upkeep can be paid. */
  upkeepPlayer: PlayerId | null
  /** Discoveries the finder may still accept or refuse. */
  offers: DiscoveryOffer[]
  /** Day 1: round start runs on the first Weiter, after claims. */
  orderPending: boolean
  lastDice: DirIndex | null
  log: string[]
  lost: boolean
  lossReason: string | null
  gameOver: boolean
  winner: Winner | null
}

export interface GameState extends Snapshot {
  past: Snapshot[]
  /** When true, that player is driven by the computer. */
  ai: Record<PlayerId, boolean>

  reset: () => void
  undo: () => void
  setAi: (player: PlayerId, on: boolean) => void
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
  /** Speicher: the player who stored the chip releases it on their simulation turn. */
  releaseStorage: (hex: Axial) => void
  passSimulation: () => void
  takeSourceChip: (hex: Axial, index: number) => void
  followRoute: (dir: DirIndex) => void
  triggerFactoryEffect: () => void
  deliverChip: (payTariff: boolean) => void
  abortChipTransport: () => void
  simClick: (hex: Axial) => void
  buildRoute: (hex: Axial, dir: DirIndex, tier: RouteTier) => void
  upgradeRoute: (hex: Axial, dir: DirIndex, tier: RouteTier) => void
  removeRoute: (hex: Axial, dir: DirIndex) => void
  setRouteFee: (hex: Axial, dir: DirIndex, fee: number) => void
  setSourceFee: (hex: Axial, fee: number) => void
  setImportFee: (hex: Axial, fee: number) => void
  selectHex: (hex: Axial | null) => void
  selectChip: (id: string | null) => void
  setPhase: (phase: PhaseId) => void
  nextPhase: () => void
  setActivePlayer: (p: PlayerId) => void
  adjustMoney: (p: PlayerId, delta: number) => void
  rollDemand: () => void
  approveConsumer: (hex: Axial, type: MeterKind) => void
  claimOffer: (id: string) => void
  declineOffer: (id: string) => void
  claimFacility: (hex: Axial) => void
  abandonFacility: (hex: Axial) => void
  /** Pay 2 and spend 1 AP to add an extractor on an owned source in range. */
  buildExtractor: (hex: Axial) => void
  rechargeTransformer: (hex: Axial) => void
  giveMoney: (amount: number) => void
  /** Select-tool: Objekt aufnehmen / ablegen (Chip oder Schiff). */
  selectAt: (hex: Axial) => void
  /** Select-tool: Schiff explizit aufnehmen (Klick auf Schiff-Marker). */
  pickShip: (player: PlayerId) => void
  moveShip: (hex: Axial, player?: PlayerId) => void
  /** Load a scenario in the chosen mode and begin day 1. */
  startScenario: (id: string, mode: GameMode, difficulty?: Difficulty) => void
  /** Pass remaining actions; hand off clockwise or enter simulation. */
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

function blankPlayers(seats: PlayerId[], money: number): Record<PlayerId, PlayerState> {
  const active = new Set(seats)
  return {
    1: { money: active.has(1) ? money : 0, owed: 0 },
    2: { money: active.has(2) ? money : 0, owed: 0 },
    3: { money: active.has(3) ? money : 0, owed: 0 },
    4: { money: active.has(4) ? money : 0, owed: 0 },
  }
}

function blankShips(
  seats: PlayerId[],
  spawns: Axial[],
): Record<PlayerId, Axial> {
  const ships: Record<PlayerId, Axial> = {
    1: { q: 99, r: 99 },
    2: { q: 99, r: 99 },
    3: { q: 99, r: 99 },
    4: { q: 99, r: 99 },
  }
  seats.forEach((id, i) => {
    ships[id] = { ...(spawns[i] ?? { q: 0, r: 0 }) }
  })
  return ships
}

function freshActions(seats: PlayerId[]): Record<PlayerId, number> {
  return {
    1: seats.includes(1) ? ACTIONS_PER_PLAYER : 0,
    2: seats.includes(2) ? ACTIONS_PER_PLAYER : 0,
    3: seats.includes(3) ? ACTIONS_PER_PLAYER : 0,
    4: seats.includes(4) ? ACTIONS_PER_PLAYER : 0,
  }
}

function emptyAi(_seats: PlayerId[]): Record<PlayerId, boolean> {
  return {
    1: false,
    2: false,
    3: false,
    4: false,
  }
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
  if (remaining === 0) {
    const next = nextWithActions(p, s.playerIds, actionsLeft)
    if (next != null) {
      return {
        ok: true,
        actionsLeft,
        activePlayer: next,
        note: `Aktionspunkt verbraucht (0 übrig). → ${playerLabel(next)}`,
      }
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
        selectedHex: null,
        log: appendLog(s.log, s.day, `Schiff ${playerLabel(player)} abgelegt.`),
      }
    }
  if (hexDistance(s.ships[player], hex) !== 1) {
    return {
      log: appendLog(s.log, s.day, 'Ein Schritt nur auf ein Nachbarfeld.'),
    }
  }
  if (cell.terrain === 'mountain') {
    return {
      log: appendLog(s.log, s.day, 'Asteroiden sind unpassierbar.'),
    }
  }
  const blocker = shipOnHex(s.ships, hex, s.playerIds)
  if (blocker != null && blocker !== player) {
    return {
      log: appendLog(s.log, s.day, 'Feld vom anderen Raumschiff besetzt.'),
    }
  }
  const spent = beginAction(s)
  if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }

  let log = appendLog(
    s.log,
    s.day,
    `${playerLabel(player)} geht nach (${hex.q},${hex.r}). ${spent.note}`,
  )
  if (SOURCE_TERRAINS.has(cell.terrain)) {
    const note = sourceVisitNote(cell)
    if (note) log = appendLog(log, s.day, note)
  }
  const previous = s.offers.filter((offer) => offer.player === player)
  if (previous.length > 0) {
    log = appendLog(
      log,
      s.day,
      `${playerLabel(player)} zieht weiter und lässt ${previous.map((offer) => offer.label).join(', ')} neutral.`,
    )
  }
  const offer = standingClaim(player, cell)
  if (offer) {
    log = appendLog(
      log,
      s.day,
      `${offer.label}: Schiff steht darauf. Übernehmen oder ablehnen, kostenlos.`,
    )
  }
  return {
    ships: { ...s.ships, [player]: { ...hex } },
    ...spentFields(s, spent),
    heldShip: null,
    selectedChipId: null,
    selectedHex: null,
    offers: [
      ...s.offers.filter((item) => item.player !== player),
      ...(offer ? [offer] : []),
    ],
    log,
  }
}

function expireActionsLog(s: Snapshot, log: string[]): string[] {
  if (s.phase !== 'act') return log
  const leftover = s.playerIds
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
    playerIds: s.playerIds,
    scenarioId: s.scenarioId,
    gameMode: s.gameMode,
    difficulty: s.difficulty,
    freibeuters: s.freibeuters,
    piratePurse: s.piratePurse,
    players: s.players,
    cells: s.cells,
    chips: s.chips,
    ships: s.ships,
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
    routes: s.routes,
    simPasses: s.simPasses,
    simDone: s.simDone,
    simQueue: s.simQueue,
    upkeepPlayer: s.upkeepPlayer,
    offers: s.offers,
    orderPending: s.orderPending,
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
  const seats = playerIdsForCount(2)
  return {
    day: 1,
    phase: 'setup',
    activePlayer: 1,
    playerIds: seats,
    scenarioId: null,
    gameMode: 'versus',
    difficulty: 'normal',
    freibeuters: [],
    piratePurse: 0,
    players: blankPlayers(seats, START_MONEY),
    cells: {},
    chips: [],
    ships: blankShips(seats, [{ q: 0, r: 0 }, { q: 0, r: 0 }]),
    actionsLeft: freshActions(seats),
    bank: 0,
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
    routes: {},
    simPasses: 0,
    simDone: false,
    simQueue: [],
    upkeepPlayer: null,
    offers: [],
    orderPending: true,
    lastDice: null,
    log: ['Szenario wählen, um zu starten.'],
    lost: false,
    lossReason: null,
    gameOver: false,
    winner: null,
  }
}

function currentMission(s: Snapshot): ScenarioMission | null {
  if (s.gameMode !== 'solo' && s.gameMode !== 'coop') return null
  if (!s.scenarioId) return null
  const raw = getScenario(s.scenarioId)?.missions?.[s.gameMode]
  if (!raw) return null
  return missionForDifficulty(raw, s.difficulty ?? 'normal')
}

function missionFail(
  s: Snapshot,
  reason: string,
): Partial<Snapshot> {
  return {
    lost: true,
    lossReason: reason,
    gameOver: true,
    winner: null,
    log: appendLog(s.log, s.day, `Mission verloren: ${reason}`),
  }
}

function evaluateMissionAtOrder(
  s: Snapshot,
  cells: Record<string, CellState>,
  day: number,
  log: string[],
): Partial<Snapshot> | null {
  const mission = currentMission(s)
  if (!mission) return null

  for (const spec of mission.planets) {
    const cell = Object.values(cells).find(
      (c) => c.terrain === 'planet' && c.planetName === spec.planetName,
    )
    if (!cell || cell.planetOwner !== spec.owner) {
      return {
        lost: true,
        lossReason: `Missionsplanet ${spec.planetName} ist nicht mehr unter Kontrolle.`,
        gameOver: true,
        winner: null,
        log: appendLog(
          log,
          day,
          `Mission verloren: ${spec.planetName} rebellierte oder wurde aufgegeben.`,
        ),
      }
    }
    if (day === mission.consumerDeadline) {
      if (!missionConsumersReady(cell, spec.needByRound8)) {
        const need = spec.needByRound8.join(' + ')
        return {
          lost: true,
          lossReason: `${spec.planetName} braucht bis Runde ${mission.consumerDeadline}: ${need}.`,
          gameOver: true,
          winner: null,
          log: appendLog(
            log,
            day,
            `Mission verloren: ${spec.planetName} hat nicht die benötigten Verbraucher (${need}).`,
          ),
        }
      }
    }
  }

  if (mission.stableRounds.includes(day as 11 | 12 | 9 | 10 | 13 | 14)) {
    // Stability is checked after simulation of that day; order phase of day N+1
    // sees day N completed. We check at order entry when day equals stable round
    // after that round's simulation by checking when entering order of day+1.
    // Here day is the NEW day at order start — so after sim of day D we enter
    // order of D+1. Check previous day.
  }

  return null
}

/** After simulation ends (entering next order / new day), check stable rounds. */
function evaluateMissionAfterDay(
  s: Snapshot,
  completedDay: number,
  cells: Record<string, CellState>,
  log: string[],
): Partial<Snapshot> | null {
  const mission = currentMission(s)
  if (!mission) return null

  const [a, b] = mission.stableRounds
  if (completedDay !== a && completedDay !== b) return null

  for (const spec of mission.planets) {
    const cell = Object.values(cells).find(
      (c) => c.terrain === 'planet' && c.planetName === spec.planetName,
    )
    if (!cell || !missionPlanetStable(cell)) {
      return {
        lost: true,
        lossReason: `${spec.planetName} war in Runde ${completedDay} nicht stabil (−3…+3).`,
        gameOver: true,
        winner: null,
        log: appendLog(
          log,
          completedDay,
          `Mission verloren: ${spec.planetName} außerhalb von −3…+3 in Runde ${completedDay}.`,
        ),
      }
    }
  }

  if (completedDay === b) {
    return {
      gameOver: true,
      lost: false,
      lossReason: null,
      winner: 'mission',
      log: appendLog(
        log,
        completedDay,
        'Mission gewonnen — alle Missionsplaneten sind stabil.',
      ),
    }
  }
  return {
    log: appendLog(
      log,
      completedDay,
      `Stabilitätscheck Runde ${completedDay} bestanden.`,
    ),
  }
}

function snapshotFromScenario(
  id: string,
  mode: GameMode,
  difficulty: Difficulty = 'normal',
): Snapshot | null {
  const scenario = getScenario(id)
  if (!scenario || !scenario.modes.includes(mode)) return null
  idSeq = 0
  const seats = playerIdsForCount(seatCountForMode(scenario, mode))
  let { cells, logLines } = cellsFromScenario(scenario)
  let routes: Record<string, Route> = {}
  const rawMission =
    mode === 'solo' || mode === 'coop'
      ? scenario.missions?.[mode]
      : undefined
  const mission = rawMission
    ? missionForDifficulty(rawMission, difficulty)
    : undefined
  if (mission) {
    const started = applySoloCoopStart(cells, mission, (prefix) => uid(prefix))
    cells = started.cells
    routes = started.routes
    logLines = [...started.logLines, ...logLines]
  }
  const freibeuters = spawnFreibeuter(
    scenario.freibeuters ?? [],
    mode,
    difficulty,
  )
  const totalBank = bankForPlayers(seats.length)
  const bank = totalBank - START_MONEY * seats.length
  const players = blankPlayers(seats, START_MONEY)
  const ships = blankShips(seats, scenario.spawns)
  const modeLabel =
    mode === 'solo' ? 'Solo' : mode === 'coop' ? 'Koop' : 'Versus'
  const names = seats.map(playerLabel).join(', ')
  const pirateLog =
    freibeuters.length > 0
      ? `Freibeuter: ${freibeuters.map(describeFreibeuterPos).join(' · ')}.`
      : null
  const setupLog = [
    `${scenario.name} (${modeLabel}${mode !== 'versus' ? `, ${difficulty}` : ''}) — ${seats.length} Spieler (${names}). Bank ${bank}, je ${START_MONEY} Startgeld.`,
    mode === 'versus'
      ? 'Versus: leere Bank beendet das Spiel. Übernehmen nur mit dem Schiff auf der Einrichtung.'
      : `Mission: ${mission?.rounds ?? 12} Runden. Leere Bank beendet nicht. Stabilität in Runden ${mission?.stableRounds.join(' und ') ?? '11 und 12'}.`,
    ...(pirateLog ? [pirateLog] : []),
    ...logLines.map((line) => `T1: ${line}`),
  ]
  return {
    day: 1,
    phase: 'order',
    activePlayer: 1,
    playerIds: seats,
    scenarioId: scenario.id,
    gameMode: mode,
    difficulty,
    freibeuters,
    piratePurse: 0,
    players,
    cells,
    chips: [],
    ships,
    actionsLeft: freshActions(seats),
    bank,
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
    routes,
    simPasses: 0,
    simDone: false,
    simQueue: [],
    upkeepPlayer: null,
    offers: [],
    orderPending: true,
    lastDice: null,
    log: setupLog.slice(0, 80),
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
  playerIds?: PlayerId[]
  actionsLeft?: Record<PlayerId, number>
}) {
  const legacy =
    state.phase === 'navigate' ||
    state.phase === 'build' ||
    state.phase === 'demand'
  state.phase = normalizePhase(state.phase)
  const seats = state.playerIds ?? playerIdsForCount(2)
  if (
    !state.actionsLeft ||
    seats.some((id) => state.actionsLeft![id] == null)
  ) {
    state.actionsLeft = freshActions(seats)
  }
  if (legacy && state.phase === 'act') {
    state.activePlayer = state.orderHolder ?? seats[0]!
    state.actionsLeft = freshActions(seats)
  }
  if (
    state.phase === 'act' &&
    state.orderHolder &&
    state.activePlayer !== state.orderHolder &&
    seats.every((id) => state.actionsLeft![id] === ACTIONS_PER_PLAYER)
  ) {
    state.activePlayer = state.orderHolder
  }
}

function normalizePhase(phase: string): PhaseId {
  if (phase === 'demand' || phase === 'navigate' || phase === 'build') return 'act'
  if (phase === 'emit') return 'simulate'
  if (phase === 'end') return 'order'
  if (
    phase === 'setup' ||
    phase === 'order' ||
    phase === 'act' ||
    phase === 'simulate'
  ) {
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
  let nextCells = cells
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
    const planet = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
    for (const cons of cell.consumers) {
      const roll = rollW4()
      if (cons.type === 'voltage') voltage += roll
      else if (cons.type === 'water') water += roll
      else heat += roll
      parts.push(`${planet} ${METER_LABELS[cons.type]} ${formatMeterDelta(roll)}`)
    }
    if (nextCells === cells) nextCells = { ...cells }
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

  return {
    cells: nextCells,
    log: nextLog,
    players,
    bank,
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

  let freibeuters = s.freibeuters ?? []

  if (phase === 'order') {
    if (bank <= 0 && s.gameMode === 'versus') {
      gameOver = true
      winner = decideWinner(players, s.playerIds)
      const reason =
        winner === 'draw' || winner === 'mission' || winner == null
          ? 'Geldstapel leer — Gleichstand, Gewinn als Team.'
          : `Geldstapel leer — ${playerLabel(winner)} gewinnt.`
      nextLog = appendLog(nextLog, day, reason)
    } else {
      if (bank <= 0 && s.gameMode !== 'versus') {
        nextLog = appendLog(
          nextLog,
          day,
          'Bank leer — in Solo/Koop kein Spielende; offene Forderungen zählen nicht.',
        )
      }
      // Freibeuter move from round 2 onward (after game-end check).
      if (day >= 2 && freibeuters.length > 0) {
        freibeuters = moveAllFreibeuter(freibeuters)
        nextLog = appendLog(
          nextLog,
          day,
          `Freibeuter: ${freibeuters.map(describeFreibeuterPos).join(' · ')}`,
        )
      }
      const missionFailPatch = evaluateMissionAtOrder(s, cells, day, nextLog)
      if (missionFailPatch) {
        return { ...missionFailPatch, cells, players, bank, freibeuters }
      }
      const sources = applySourceRebellions(cells, day, nextLog)
      const planets = applyColonyDestruction(sources.cells, day, sources.log)
      cells = planets.cells
      nextLog = planets.log
      // Mission planets that rebelled → immediate loss
      const afterRebel = evaluateMissionAtOrder(s, cells, day, nextLog)
      if (afterRebel) {
        return { ...afterRebel, cells, players, bank, freibeuters }
      }
      const who = firstWhoMustClose(players, cells, s.orderHolder, s.playerIds)
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
    actionsLeft = freshActions(s.playerIds)
    activePlayer = s.orderHolder
    const order = s.playerIds
    const from = order.indexOf(s.orderHolder)
    const rotated =
      from >= 0
        ? [...order.slice(from), ...order.slice(0, from)]
        : order
    const names = rotated.map(
      (id) => `${playerLabel(id)} (${ACTIONS_PER_PLAYER})`,
    )
    nextLog = appendLog(
      nextLog,
      day,
      `Aktionsphase: ${names.join(' → ')}. Ungenutzte Punkte verfallen.`,
    )
  }

  if (phase === 'simulate') {
    activePlayer = s.orderHolder
    nextLog = appendLog(
      nextLog,
      day,
      `Simulation: ${playerLabel(s.orderHolder)} beginnt. Ein Zug entnimmt einen Chip oder gibt eine eigene Speicherladung frei.`,
    )
  }

  return {
    cells,
    players,
    bank,
    freibeuters,
    log: nextLog,
    simPasses: 0,
    simDone: false,
    simQueue: [],
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
  return factoryCount(cells, player) * FACTORY_UPKEEP > players[player].money
}

function factoriesToDrop(
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
  player: PlayerId,
): number {
  const money = players[player].money
  let count = factoryCount(cells, player)
  let drop = 0
  while (count > 0 && count * FACTORY_UPKEEP > money) {
    count -= 1
    drop += 1
  }
  return drop
}

/** Order-chip holder first, then clockwise. */
function firstWhoMustClose(
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
  start: PlayerId,
  seats: PlayerId[],
): PlayerId | null {
  let p = start
  for (let i = 0; i < seats.length; i++) {
    if (mustCloseFactories(players, cells, p)) return p
    p = nextClockwise(p, seats)
  }
  return null
}

function closurePrompt(
  player: PlayerId,
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
): string {
  const count = factoryCount(cells, player)
  const money = players[player].money
  const drop = factoriesToDrop(players, cells, player)
  return `${playerLabel(player)} hat ${money} Geld und ${count} ${count === 1 ? 'Fabrik' : 'Fabriken'} (Unterhalt ${FACTORY_UPKEEP} je Fabrik). ${drop} neutralisieren, bis der Rest bezahlbar ist.`
}

/** Pay full upkeep, then order chip, demand and production. Rebellions already ran. */
function finishOrderStart(
  s: Snapshot,
  cells: Record<string, CellState>,
  players: Record<PlayerId, PlayerState>,
  bank: number,
  day: number,
  log: string[],
): Partial<Snapshot> {
  const upkeep = payFactoryUpkeep(players, cells, bank, day, log, s.playerIds)
  const orderHolder = assignOrderChip(upkeep.players, s.orderHolder, s.playerIds)
  let nextLog = appendLog(
    upkeep.log,
    day,
    `Reihenfolgechip: ${playerLabel(orderHolder)} beginnt.`,
  )
  const rolled = runDemandRoll(
    cells,
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

/** 2 Geld pro eigener Fabrik an die Bank. Neutrale Fabriken kosten nichts. */
function payFactoryUpkeep(
  players: Record<PlayerId, PlayerState>,
  cells: Record<string, CellState>,
  bank: number,
  day: number,
  log: string[],
  seats: PlayerId[],
): { players: Record<PlayerId, PlayerState>; bank: number; log: string[] } {
  const due = {} as Record<PlayerId, number>
  for (const id of seats) due[id] = 0
  for (const cell of Object.values(cells)) {
    const owner = cell.field?.owner
    if (owner != null && due[owner] != null) due[owner] += FACTORY_UPKEEP
  }
  let next = players
  let nextBank = bank
  let nextLog = log
  for (const player of seats) {
    const amount = due[player]
    if (amount === 0 || next[player].money < amount) continue
    const count = amount / FACTORY_UPKEEP
    next = {
      ...next,
      [player]: { ...next[player], money: next[player].money - amount },
    }
    nextBank += amount
    nextLog = appendLog(
      nextLog,
      day,
      `${playerLabel(player)} zahlt ${amount} Fabrikunterhalt für ${count} ${count === 1 ? 'Fabrik' : 'Fabriken'}.`,
    )
  }
  return { players: next, bank: nextBank, log: nextLog }
}

function runPendingRoundStart(s: Snapshot): {
  snapshot: Snapshot
  patch: Partial<Snapshot> | null
  blocked: boolean
} {
  if (!s.orderPending || s.phase !== 'order') {
    return { snapshot: s, patch: null, blocked: false }
  }
  const started = applyPhaseEntry(
    s,
    'order',
    s.day,
    appendLog(s.log, s.day, 'Rundenstart'),
  )
  const snapshot: Snapshot = {
    ...s,
    ...started,
    phase: 'order',
    orderPending: false,
  }
  return {
    snapshot,
    patch: { ...started, orderPending: false },
    blocked: Boolean(snapshot.gameOver || snapshot.upkeepPlayer),
  }
}

function routeAt(
  s: Snapshot,
  hex: Axial,
  dir: DirIndex,
): { key: string; dest: Axial; route: Route } | null {
  const dest = neighbor(hex, dir)
  const key = edgeKey(hex, dest)
  const route = s.routes[key]
  if (!route) return null
  return { key, dest, route }
}

function routeReachError(s: Snapshot, hex: Axial, dest: Axial): string | null {
  const ship = s.ships[s.activePlayer]
  if (!inShipRange(ship, hex) && !inShipRange(ship, dest)) {
    return 'Das Schiff muss auf einem der Felder oder daneben stehen.'
  }
  return null
}

function routeEdgeError(s: Snapshot, hex: Axial, dest: Axial): string | null {
  const a = s.cells[hexKey(hex)]
  const b = s.cells[hexKey(dest)]
  if (!a || !b) return 'Außerhalb des Spielfelds.'
  if (!a.revealed || !b.revealed) return 'Beide Felder müssen entdeckt sein.'
  if (a.terrain === 'mountain' || b.terrain === 'mountain') {
    return 'Kein Weg über einen Asteroiden.'
  }
  return routeReachError(s, hex, dest)
}

function placeRoute(
  s: Snapshot,
  hex: Axial,
  dir: DirIndex,
  tier: RouteTier,
  mode: 'build' | 'upgrade',
): Partial<Snapshot> {
  if (s.phase !== 'act') {
    return { log: appendLog(s.log, s.day, 'Wege nur in der Aktionsphase.') }
  }
  const dest = neighbor(hex, dir)
  const key = edgeKey(hex, dest)
  const edgeError = routeEdgeError(s, hex, dest)
  if (edgeError) return { log: appendLog(s.log, s.day, edgeError) }
  const player = s.activePlayer
  const existing = s.routes[key]
  const label = TIER_LABEL[tier]
  if (mode === 'build') {
    if (existing) {
      return { log: appendLog(s.log, s.day, 'Diese Kante ist schon bebaut.') }
    }
    const spent = beginAction(s)
    if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
    const cost = ROUTE_BUILD_COST[tier]
    const paid = payToBank(s.players, s.bank, player, cost)
    if (!paid) {
      return {
        log: appendLog(
          s.log,
          s.day,
          `Nicht genug Geld (${cost}) für einen ${label}-Weg.`,
        ),
      }
    }
    return {
      routes: { ...s.routes, [key]: { owner: player, tier, fee: 0 } },
      players: paid.players,
      bank: paid.bank,
      ...spentFields(s, spent),
      log: appendLog(
        s.log,
        s.day,
        `${playerLabel(player)} baut einen ${label}-Weg Richtung ${DIRECTIONS[dir - 1].label} für ${cost} Geld. ${spent.note}`,
      ),
    }
  }
  if (!existing) {
    return { log: appendLog(s.log, s.day, 'Kein Weg zum Aufwerten.') }
  }
  if (existing.owner !== player) {
    return {
      log: appendLog(
        s.log,
        s.day,
        `Der Weg gehört ${playerLabel(existing.owner)}.`,
      ),
    }
  }
  const cost = upgradeCost(existing.tier, tier)
  if (cost == null) {
    return {
      log: appendLog(s.log, s.day, 'Dieser Weg ist schon mindestens so gut.'),
    }
  }
  const spent = beginAction(s)
  if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
  const paid = payToBank(s.players, s.bank, player, cost)
  if (!paid) {
    return {
      log: appendLog(s.log, s.day, `Nicht genug Geld (${cost}) für die Aufwertung.`),
    }
  }
  return {
    routes: { ...s.routes, [key]: { ...existing, tier } },
    players: paid.players,
    bank: paid.bank,
    ...spentFields(s, spent),
    log: appendLog(
      s.log,
      s.day,
      `${playerLabel(player)} wertet den Weg auf ${label} auf für ${cost} Geld. ${spent.note}`,
    ),
  }
}

function setOwnedFee(
  s: Snapshot,
  owner: PlayerId | null | undefined,
  fee: number,
  apply: (next: number) => Partial<Snapshot>,
): Partial<Snapshot> {
  if (s.phase !== 'act') {
    return {
      log: appendLog(s.log, s.day, 'Gebühren nur in der Aktionsphase ändern.'),
    }
  }
  if (owner == null) {
    return {
      log: appendLog(s.log, s.day, 'Neutrale Einrichtungen haben keine Gebühr.'),
    }
  }
  if (owner !== s.activePlayer) {
    return { log: appendLog(s.log, s.day, `Gehört ${playerLabel(owner)}.`) }
  }
  return apply(clampFee(fee))
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
        ai: emptyAi(playerIdsForCount(2)),

        reset: () =>
          set({
            ...initialData(),
            past: [],
            ai: emptyAi(playerIdsForCount(2)),
          }),

        startScenario: (id, mode, difficulty = 'normal') => {
          const snap = snapshotFromScenario(id, mode, difficulty)
          if (!snap) return
          set({
            ...snap,
            past: [],
            ai: emptyAi(snap.playerIds),
          })
          syncIdSeq(
            [],
            snap.cells,
          )
        },

        setAi: (player, on) =>
          setUi((s) => ({
            ai: { ...emptyAi(s.playerIds), ...s.ai, [player]: on },
          })),

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
            if (
              s.phase === 'simulate' &&
              phase !== 'simulate' &&
              flightOpen(s)
            ) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Erst den Chip in der Simulation abwickeln oder abbrechen.',
                ),
              }
            }
            if (s.upkeepPlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zuerst Fabriken neutralisieren, bis der Unterhalt bezahlbar ist.',
                ),
              }
            }
            if (s.gameOver) return null
            const pending = runPendingRoundStart(s)
            if (pending.blocked) {
              return {
                ...pending.patch,
                heldShip: null,
                developingSource: false,
                buildAimHex: null,
                pendingHit: null,
                tool: 'select',
              }
            }
            const cur = pending.snapshot
            if (cur.phase === phase) return pending.patch
            const log = expireActionsLog(cur, cur.log)
            const entered = applyPhaseEntry(cur, phase, cur.day, log)
            return {
              phase,
              ...entered,
              orderPending: false,
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
            if (s.phase === 'setup') {
              return {
                log: appendLog(s.log, s.day, 'Zuerst ein Szenario wählen.'),
              }
            }
            if (s.phase === 'simulate' && flightOpen(s)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Erst den Chip in der Simulation abwickeln oder abbrechen.',
                ),
              }
            }
            if (s.upkeepPlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zuerst Fabriken neutralisieren, bis der Unterhalt bezahlbar ist.',
                ),
              }
            }
            if (s.gameOver) return null
            const pending = runPendingRoundStart(s)
            if (pending.blocked) {
              return {
                ...pending.patch,
                heldShip: null,
                developingSource: false,
                buildAimHex: null,
                pendingHit: null,
                tool: 'select',
              }
            }
            const cur = pending.snapshot
            const i = PHASES.findIndex((p) => p.id === cur.phase)
            const next = PHASES[(i + 1) % PHASES.length]
            let day = cur.day
            let log = appendLog(cur.log, cur.day, `Phase → ${next.label}`)
            log = expireActionsLog(cur, log)

            if (next.id === 'order' && cur.phase === 'simulate') {
              const missionEnd = evaluateMissionAfterDay(
                cur,
                cur.day,
                cur.cells,
                log,
              )
              if (missionEnd?.gameOver) {
                return {
                  ...missionEnd,
                  heldShip: null,
                  selectedChipId: null,
                  developingSource: false,
                  buildAimHex: null,
                  pendingHit: null,
                  tool: 'select',
                }
              }
              if (missionEnd?.log) log = missionEnd.log
              day = cur.day + 1
              log = appendLog(log, day, `Tag ${day} beginnt.`)
            }

            const entered = applyPhaseEntry({ ...cur, day }, next.id, day, log)
            return {
              phase: next.id,
              day,
              ...entered,
              orderPending: false,
              heldShip: null,
              selectedChipId: next.id === 'simulate' ? null : cur.selectedChipId,
              developingSource: false,
              buildAimHex: null,
              pendingHit: null,
              tool: 'select',
            }
          })
        },

        setActivePlayer: (activePlayer) =>
          commit((s) => {
            if (s.phase === 'act' || s.phase === 'simulate') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Der Zug wechselt am Ende der Aktion von allein.',
                ),
              }
            }
            return { activePlayer }
          }),

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
            if (s.phase === 'simulate') {
              return clickDuringSim(s, hex, () => uid('fly'))
            }
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
            if (s.phase !== 'act' || s.gameOver) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Aktionen beenden nur in der Aktionsphase.',
                ),
              }
            }
            if (s.upkeepPlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Zuerst Fabriken neutralisieren, bis der Unterhalt bezahlbar ist.',
                ),
              }
            }
            const p = s.activePlayer
            const left = s.actionsLeft[p] ?? 0
            const expired =
              left === 1
                ? '1 Aktionspunkt verfällt'
                : `${left} Aktionspunkte verfallen`
            const actionsLeft = { ...s.actionsLeft, [p]: 0 }
            const note =
              left > 0
                ? `${playerLabel(p)} beendet die Aktionen. ${expired}.`
                : `${playerLabel(p)} beendet die Aktionen.`
            const next = nextWithActions(p, s.playerIds, actionsLeft)
            if (next != null) {
              return {
                actionsLeft,
                activePlayer: next,
                heldShip: null,
                selectedChipId: null,
                developingSource: false,
                log: appendLog(s.log, s.day, `${note} → ${playerLabel(next)}`),
              }
            }
            const log = appendLog(
              appendLog(s.log, s.day, note),
              s.day,
              'Phase → Simulation',
            )
            const entered = applyPhaseEntry(
              { ...s, actionsLeft },
              'simulate',
              s.day,
              log,
            )
            return {
              phase: 'simulate',
              actionsLeft,
              ...entered,
              heldShip: null,
              selectedChipId: null,
              developingSource: false,
              buildAimHex: null,
              pendingHit: null,
            }
          })
        },

        claimOffer: (id) => {
          commit((s) => {
            const offer = s.offers.find((item) => item.id === id)
            if (!offer) {
              return { log: appendLog(s.log, s.day, 'Dieses Angebot ist weg.') }
            }
            const key = hexKey(offer.hex)
            const cell = s.cells[key]
            if (!cell) return null
            if (s.phase !== 'act') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Übernehmen nur in der eigenen Aktionsphase.',
                ),
              }
            }
            if (offer.player !== s.activePlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `${playerLabel(s.activePlayer)} ist am Zug.`,
                ),
              }
            }
            if (!hexEquals(s.ships[offer.player], offer.hex)) {
              return {
                offers: s.offers.filter((item) => item.id !== id),
                log: appendLog(
                  s.log,
                  s.day,
                  'Das Schiff muss auf der Einrichtung stehen.',
                ),
              }
            }
            const claimed = claimCell(cell, offer.player)
            if ('error' in claimed) {
              return {
                offers: s.offers.filter((item) => item.id !== id),
                log: appendLog(s.log, s.day, claimed.error),
              }
            }
            return {
              cells: { ...s.cells, [key]: claimed.cell },
              offers: s.offers.filter(
                (item) =>
                  item.hex.q !== offer.hex.q || item.hex.r !== offer.hex.r,
              ),
              log: appendLog(s.log, s.day, claimed.note),
            }
          })
        },

        declineOffer: (id) => {
          commit((s) => {
            const offer = s.offers.find((item) => item.id === id)
            if (!offer) return null
            return {
              offers: s.offers.filter((item) => item.id !== id),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(offer.player)} lässt ${offer.label} neutral.`,
              ),
            }
          })
        },

        claimFacility: (hex) => {
          commit((s) => {
            if (s.phase !== 'act') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Neutrale Einrichtungen nur in der eigenen Aktionsphase übernehmen.',
                ),
              }
            }
            const player = s.activePlayer
            if (!hexEquals(s.ships[player], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Das Schiff muss auf dem Feld stehen.',
                ),
              }
            }
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell?.revealed) {
              return { log: appendLog(s.log, s.day, 'Feld ist noch unentdeckt.') }
            }
            const claimed = claimCell(cell, player)
            if ('error' in claimed) {
              return { log: appendLog(s.log, s.day, claimed.error) }
            }
            return {
              cells: { ...s.cells, [key]: claimed.cell },
              offers: s.offers.filter(
                (item) => item.hex.q !== hex.q || item.hex.r !== hex.r,
              ),
              log: appendLog(s.log, s.day, claimed.note),
            }
          })
        },

        abandonFacility: (hex) => {
          commit((s) => {
            if (s.phase !== 'act') {
              return {
                log: appendLog(s.log, s.day, 'Aufgeben nur in der Aktionsphase.'),
              }
            }
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell?.revealed) return null
            const left = abandonCell(cell, s.activePlayer)
            if ('error' in left) {
              return { log: appendLog(s.log, s.day, left.error) }
            }
            const cells = { ...s.cells, [key]: left.cell }
            const mission = currentMission(s)
            if (
              mission &&
              cell.terrain === 'planet' &&
              mission.planets.some((p) => p.planetName === cell.planetName)
            ) {
              return {
                cells,
                ...missionFail(
                  { ...s, cells, log: appendLog(s.log, s.day, left.note) },
                  `Missionsplanet ${cell.planetName} wurde aufgegeben.`,
                ),
              }
            }
            return {
              cells,
              offers: s.offers.filter(
                (item) => item.hex.q !== hex.q || item.hex.r !== hex.r,
              ),
              log: appendLog(s.log, s.day, left.note),
            }
          })
        },

        buildExtractor: (hex) => {
          commit((s) => {
            if (s.phase !== 'act') {
              return {
                log: appendLog(s.log, s.day, 'Extraktoren nur in der Aktionsphase.'),
              }
            }
            const key = hexKey(hex)
            const cell = s.cells[key]
            const player = s.activePlayer
            if (!cell?.revealed || !SOURCE_TERRAINS.has(cell.terrain)) {
              return { log: appendLog(s.log, s.day, 'Keine Quelle auf diesem Feld.') }
            }
            if (cell.sourceOwner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  cell.sourceOwner == null
                    ? 'Neutrale Quelle zuerst übernehmen.'
                    : `Quelle gehört ${playerLabel(cell.sourceOwner)}.`,
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
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
            const paid = payToBank(s.players, s.bank, player, EXTRACTOR_COST)
            if (!paid) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Nicht genug Geld (${EXTRACTOR_COST}) für einen Extraktor.`,
                ),
              }
            }
            const next = extractorCount(cell) + 1
            const name = LANDSCAPE_LABELS[cell.terrain as 'sun' | 'water' | 'uranium']
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, extractors: next },
              },
              players: paid.players,
              bank: paid.bank,
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(player)} baut Extraktor ${next} auf ${name} (${hex.q},${hex.r}) für ${EXTRACTOR_COST} Geld. ${spent.note}`,
              ),
            }
          })
        },

        rechargeTransformer: (hex) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            const field = cell?.field
            if (!cell || !field || field.kind !== 'transformer') {
              return { log: appendLog(s.log, s.day, 'Kein Trafo auf diesem Feld.') }
            }
            if (field.owner !== s.activePlayer) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  field.owner == null
                    ? 'Neutraler Trafo muss zuerst übernommen werden.'
                    : `Trafo gehört ${playerLabel(field.owner)}.`,
                ),
              }
            }
            if (s.phase !== 'act') {
              return {
                log: appendLog(s.log, s.day, 'Aufladen nur in der Aktionsphase.'),
              }
            }
            if (!inShipRange(s.ships[s.activePlayer], hex)) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Das Schiff muss auf dem Trafo oder daneben stehen.',
                ),
              }
            }
            const missing = 4 - field.charge.length
            if (missing <= 0) {
              return {
                log: appendLog(s.log, s.day, 'Der Trafo hat schon vier Ladungen.'),
              }
            }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
            const paid = payToBank(s.players, s.bank, s.activePlayer, TRAFO_RELOAD_COST)
            if (!paid) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Nicht genug Geld (${TRAFO_RELOAD_COST}) zum Aufladen.`,
                ),
              }
            }
            const charge = [...field.charge]
            for (let i = 0; i < missing; i++) charge.push(randomColor())
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, field: { ...field, charge } },
              },
              players: paid.players,
              bank: paid.bank,
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(s.activePlayer)} lädt den Trafo auf 4 Spannungschips für ${TRAFO_RELOAD_COST} Geld. ${spent.note}`,
              ),
            }
          })
        },

        giveMoney: (amount) => {
          commit((s) => {
            if (s.phase !== 'act') {
              return {
                log: appendLog(s.log, s.day, 'Verschenken nur in der Aktionsphase.'),
              }
            }
            const from = s.activePlayer
            const to = nextClockwise(from, s.playerIds)
            const gift = Math.floor(amount)
            if (gift <= 0) return null
            if (s.players[from].money < gift) {
              return {
                log: appendLog(s.log, s.day, 'Nicht genug Geld zum Verschenken.'),
              }
            }
            return {
              players: {
                ...s.players,
                [from]: { ...s.players[from], money: s.players[from].money - gift },
                [to]: { ...s.players[to], money: s.players[to].money + gift },
              },
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(from)} schenkt ${playerLabel(to)} ${gift} Geld.`,
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
            if (cell.planetOwner == null) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Neutrale Planeten: zuerst übernehmen, dann Verbraucher genehmigen.',
                ),
              }
            }
            if (cell.planetOwner !== owner) {
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

            const paid = payToBank(s.players, s.bank, owner, CONSUMER_COST)
            if (!paid) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Nicht genug Geld (${CONSUMER_COST}) für einen Verbraucher.`,
                ),
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
                },
              },
              players: paid.players,
              bank: paid.bank,
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(owner)} genehmigt ${METER_LABELS[type]}-Verbraucher auf ${cell.planetName ?? `(${hex.q},${hex.r})`} für ${CONSUMER_COST} Geld. ${spent.note}`,
              ),
            }
          })
        },

        seedSourcesForEmit: () => {
          commit((s) => {
            const emitted = emitRevealedSources(s.cells, s.day, s.log)
            return { cells: emitted.cells, log: emitted.log }
          })
        },

        adjustMeter: (hex, meter, delta) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell || cell.terrain !== 'planet' || delta === 0) return null
            const nextValue = cell[meter] + delta
            const name = cell.planetName ?? `(${hex.q},${hex.r})`
            return {
              cells: {
                ...s.cells,
                [key]: { ...cell, [meter]: nextValue },
              },
              log: appendLog(
                s.log,
                s.day,
                `${name} ${METER_LABELS[meter]} ${formatMeterDelta(delta)}.`,
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
              const who = cell.field.owner
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  who == null
                    ? 'Neutraler Trafo muss zuerst übernommen werden.'
                    : `Nur ${playerLabel(who)} kann den Trafo nachladen.`,
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
                    owner:
                      recharging && cell.field?.owner != null
                        ? cell.field.owner
                        : owner,
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
              const who = cell.field.owner
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  who == null
                    ? 'Neutrale Fabriken haben keinen Richtungspfeil.'
                    : `Fabrik gehört ${playerLabel(who)}.`,
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
            const next = clampFee(fee)
            if (!cell?.revealed || !cell.field) {
              return { log: appendLog(s.log, s.day, 'Keine Fabrik auf diesem Feld.') }
            }
            if (clampFee(cell.field.fee ?? 0) === next) {
              return {
                log: appendLog(s.log, s.day, `Gebühr ist bereits ${next}.`),
              }
            }
            const name = FIELD_DEFS[cell.field.kind].name
            return setOwnedFee(s, cell.field.owner, next, () => ({
              cells: {
                ...s.cells,
                [key]: { ...cell, field: { ...cell.field!, fee: next } },
              },
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(s.activePlayer)} setzt die Verarbeitungsgebühr von ${name} auf ${next}.`,
              ),
            }))
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
                if (cell.field.owner == null) {
                  return {
                    pendingHit: null,
                    log: appendLog(
                      s.log,
                      s.day,
                      `${FIELD_DEFS[cell.field.kind].name} ist neutral und inaktiv.`,
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
            if (s.phase !== 'simulate') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Ladung freigeben nur in der Simulation.',
                ),
              }
            }
            return releaseStoredChip(s, hex, () => uid('fly'))
          })
        },

        passSimulation: () => {
          commit((s) => {
            if (s.phase !== 'simulate') {
              return {
                log: appendLog(s.log, s.day, 'Passen nur in der Simulation.'),
              }
            }
            return passSimulation(s)
          })
        },

        takeSourceChip: (hex, index) => {
          commit((s) => {
            if (s.phase !== 'simulate') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'Chips entnehmen nur in der Simulation.',
                ),
              }
            }
            return takeSourceChip(s, hex, index, () => uid('fly'))
          })
        },

        followRoute: (dir) => {
          commit((s) => {
            if (s.phase !== 'simulate') return null
            return routeAlong(s, dir)
          })
        },

        triggerFactoryEffect: () => {
          commit((s) => {
            if (s.phase !== 'simulate') return null
            return triggerFactory(s, () => uid('fly'))
          })
        },

        deliverChip: (payTariff) => {
          commit((s) => {
            if (s.phase !== 'simulate') return null
            return deliverChip(s, payTariff)
          })
        },

        abortChipTransport: () => {
          commit((s) => {
            if (s.phase !== 'simulate') return null
            return abortTransport(s)
          })
        },

        simClick: (hex) => {
          commit((s) => {
            if (s.phase !== 'simulate') return null
            return clickDuringSim(s, hex, () => uid('fly'))
          })
        },

        buildRoute: (hex, dir, tier) => {
          commit((s) => placeRoute(s, hex, dir, tier, 'build'))
        },

        upgradeRoute: (hex, dir, tier) => {
          commit((s) => placeRoute(s, hex, dir, tier, 'upgrade'))
        },

        removeRoute: (hex, dir) => {
          commit((s) => {
            const player = s.activePlayer
            const located = routeAt(s, hex, dir)
            if (!located) {
              return { log: appendLog(s.log, s.day, 'Kein Weg auf dieser Kante.') }
            }
            if (located.route.owner !== player) {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  `Der Weg gehört ${playerLabel(located.route.owner)}.`,
                ),
              }
            }
            const reach = routeReachError(s, hex, located.dest)
            if (reach) return { log: appendLog(s.log, s.day, reach) }
            const spent = beginAction(s)
            if (!spent.ok) return { log: appendLog(s.log, s.day, spent.message) }
            const routes = { ...s.routes }
            delete routes[located.key]
            return {
              routes,
              ...spentFields(s, spent),
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(player)} baut den Weg ab. Baukosten werden nicht erstattet. ${spent.note}`,
              ),
            }
          })
        },

        setRouteFee: (hex, dir, fee) => {
          commit((s) => {
            const located = routeAt(s, hex, dir)
            if (!located) {
              return { log: appendLog(s.log, s.day, 'Kein Weg auf dieser Kante.') }
            }
            return setOwnedFee(s, located.route.owner, fee, (next) => ({
              routes: {
                ...s.routes,
                [located.key]: { ...located.route, fee: next },
              },
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(s.activePlayer)} setzt die Weggebühr auf ${next}.`,
              ),
            }))
          })
        },

        setSourceFee: (hex, fee) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell?.revealed || !SOURCE_TERRAINS.has(cell.terrain)) {
              return { log: appendLog(s.log, s.day, 'Keine Quelle auf diesem Feld.') }
            }
            return setOwnedFee(s, cell.sourceOwner, fee, (next) => ({
              cells: {
                ...s.cells,
                [key]: { ...cell, sourceFee: next },
              },
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(s.activePlayer)} setzt die Abbaugebühr auf ${next}.`,
              ),
            }))
          })
        },

        setImportFee: (hex, fee) => {
          commit((s) => {
            const key = hexKey(hex)
            const cell = s.cells[key]
            if (!cell?.revealed || cell.terrain !== 'planet') {
              return { log: appendLog(s.log, s.day, 'Kein Planet auf diesem Feld.') }
            }
            return setOwnedFee(s, cell.planetOwner, fee, (next) => ({
              cells: {
                ...s.cells,
                [key]: { ...cell, importFee: next },
              },
              log: appendLog(
                s.log,
                s.day,
                `${playerLabel(s.activePlayer)} setzt den Importzoll auf ${next}.`,
              ),
            }))
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
              [key]: { ...cell, field: neutralizeFactory(cell.field) },
            }
            let log = appendLog(
              s.log,
              s.day,
              `${playerLabel(player)} neutralisiert ${name} (${hex.q},${hex.r}). ${charges} Ladung in den Beutel.`,
            )
            const who = firstWhoMustClose(s.players, cells, player, s.playerIds)
            if (who) {
              log = appendLog(
                log,
                s.day,
                who === player
                  ? `Noch ${factoriesToDrop(s.players, cells, player)} neutralisieren.`
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
              if (s.phase !== 'act') {
                return {
                  log: appendLog(
                    s.log,
                    s.day,
                    'Aufgeben nur in der Aktionsphase.',
                  ),
                }
              }
              const left = abandonCell(cell, player)
              if ('error' in left) {
                return { log: appendLog(s.log, s.day, left.error) }
              }
              return {
                cells: { ...s.cells, [key]: left.cell },
                log: appendLog(s.log, s.day, left.note),
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
              (cell.sourceOwner != null ||
                cell.sourceDir != null ||
                extractorCount(cell) > 0)
            ) {
              return {
                cells: {
                  ...s.cells,
                  [key]: neutralSource(cell),
                },
                log: appendLog(
                  s.log,
                  s.day,
                  `Quelle neutralisiert (${hex.q},${hex.r}). Extraktoren und Lager weg.`,
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
            if (s.phase === 'simulate') {
              return {
                log: appendLog(
                  s.log,
                  s.day,
                  'In der Simulation läuft der Chip über Transportwege.',
                ),
              }
            }
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
          commit((s) => {
            if (s.phase === 'simulate') {
              const chip = s.chips.find((c) => c.id === chipId)
              if (chip?.state === 'flying') return abortTransport(s)
              if (s.simQueue.includes(chipId)) {
                return {
                  chips: s.chips.filter((c) => c.id !== chipId),
                  simQueue: s.simQueue.filter((id) => id !== chipId),
                  log: appendLog(
                    s.log,
                    s.day,
                    'Wartender Chip zurück in den Beutel.',
                  ),
                }
              }
            }
            return {
              chips: s.chips.filter((c) => c.id !== chipId),
              selectedChipId:
                s.selectedChipId === chipId ? null : s.selectedChipId,
            }
          })
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
            let planetName = cell.planetName
            if (terrain === 'planet' && !planetName) {
              planetName = `Planet-${hex.q},${hex.r}`
            }
            if (terrain !== 'planet') planetName = undefined
            const stayingSource =
              SOURCE_TERRAINS.has(terrain) && SOURCE_TERRAINS.has(cell.terrain)
            return {
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
                  extractors: stayingSource ? extractorCount(cell) : 0,
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
        ai: s.ai,
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
        if (!state.playerIds || state.playerIds.length < 2) {
          state.playerIds = playerIdsForCount(2)
        }
        if (state.scenarioId === undefined) state.scenarioId = null
        if (!state.gameMode) state.gameMode = 'versus'
        if (!state.difficulty) state.difficulty = 'normal'
        if (!state.freibeuters) state.freibeuters = []
        if (state.piratePurse == null) state.piratePurse = 0
        if (state.orderHolder == null) state.orderHolder = state.playerIds[0] ?? 1
        if (state.players) {
          for (const p of state.playerIds) {
            if (state.players[p] && state.players[p].owed == null) {
              state.players[p].owed = 0
            }
          }
        }
        if (state.bank == null) {
          const held = state.playerIds.reduce(
            (sum, p) => sum + (state.players?.[p]?.money ?? 0),
            0,
          )
          state.bank = Math.max(
            0,
            bankForPlayers(state.playerIds.length) - held,
          )
        }
        if (state.developingSource == null) state.developingSource = false
        if (state.buildAimHex === undefined) state.buildAimHex = null
        if (state.draftFee == null) state.draftFee = 0
        if (state.pendingHit === undefined) state.pendingHit = null
        if (!state.routes) state.routes = {}
        if (state.simPasses == null) state.simPasses = 0
        if (state.simDone == null) state.simDone = false
        if (!state.simQueue) state.simQueue = []
        if (state.upkeepPlayer === undefined) state.upkeepPlayer = null
        if (!state.offers) state.offers = []
        if (state.orderPending == null) state.orderPending = false
        if (!state.ai) state.ai = emptyAi(state.playerIds)
        else {
          for (const p of state.playerIds) {
            if (state.ai[p] == null) state.ai[p] = false
          }
        }
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
          if (!snap.routes) snap.routes = {}
          if (snap.simPasses == null) snap.simPasses = 0
          if (snap.simDone == null) snap.simDone = false
          if (!snap.simQueue) snap.simQueue = []
          if (snap.upkeepPlayer === undefined) snap.upkeepPlayer = null
          if (!snap.offers) snap.offers = []
          if (snap.orderPending == null) snap.orderPending = false
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
