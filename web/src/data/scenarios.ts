import { FIELD_DEFS } from './fields'
import type { FreibeuterDef } from './freibeuter'
import { edgeKey, hexDistance, hexKey } from '../hex/math'
import type {
  Axial,
  CellState,
  FieldKind,
  GameMode,
  MeterKind,
  PlacedField,
  PlayerId,
  Route,
  TerrainKind,
} from '../types'

export type ScenarioCell = {
  q: number
  r: number
  terrain: TerrainKind
  factory?: FieldKind
  planetName?: string
}

/** One mission planet for solo/coop: owner and consumers due by round 8. */
export type MissionPlanet = {
  planetName: string
  owner: PlayerId
  /** Distinct consumer kinds required by the end of round 8. */
  needByRound8: MeterKind[]
  /** Consumer present at start. */
  startConsumer: MeterKind
}

export type ScenarioMission = {
  /** Normal difficulty: total rounds and the two stable check rounds. */
  rounds: number
  stableRounds: [number, number]
  consumerDeadline: number
  planets: MissionPlanet[]
}

export type Scenario = {
  id: string
  name: string
  blurb: string
  /** Competitive player count when played as versus. */
  playerCount: 2 | 3 | 4
  /** Modes this map supports (Polarität/Kanalwelt: solo+coop+versus). */
  modes: GameMode[]
  focus: string
  spawns: Axial[]
  cells: ScenarioCell[]
  missions?: Partial<Record<'solo' | 'coop', ScenarioMission>>
  /** Solo/Koop freibeuter routes (solo uses only the first). */
  freibeuters?: FreibeuterDef[]
}

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  solo: 'Solo',
  coop: 'Koop',
  versus: 'Versus',
}

export const GAME_MODE_BLURBS: Record<GameMode, string> = {
  solo: '1 Spieler · Mission in 12 Runden trotz Freibeutern',
  coop: '2 Spieler · Gemeinsame Mission, getrennte Kassen',
  versus: '2–4 Spieler · Reichstes Vermögen bei leerer Bank',
}

export function scenariosForMode(mode: GameMode): Scenario[] {
  return SCENARIOS.filter((s) => s.modes.includes(mode))
}

export function seatCountForMode(
  scenario: Scenario,
  mode: GameMode,
): 1 | 2 | 3 | 4 {
  if (mode === 'solo') return 1
  if (mode === 'coop') return 2
  return scenario.playerCount
}

function c(
  q: number,
  r: number,
  terrain: TerrainKind = 'empty',
  extra?: { factory?: FieldKind; planetName?: string },
): ScenarioCell {
  return { q, r, terrain, ...extra }
}

function dedupe(cells: ScenarioCell[]): ScenarioCell[] {
  const map = new Map<string, ScenarioCell>()
  for (const cell of cells) map.set(`${cell.q},${cell.r}`, cell)
  return [...map.values()]
}

/**
 * Polarität — rules §11 A: hex disk radius 3.
 * West: sun + solar + storage. East: sun + thermal + transformer. Water center.
 */
const twinSuns: Scenario = {
  id: 'twin-suns',
  name: 'Polarität',
  blurb:
    'Beide haben Sonne, aber West macht Spannung und speichert, Ost macht Wärme und lädt den Trafo. Das einzige Wasser liegt in der Mitte.',
  playerCount: 2,
  modes: ['solo', 'coop', 'versus'],
  focus: 'Solar + Speicher ↔ Thermo + Trafo',
  spawns: [
    { q: -3, r: 0 },
    { q: 3, r: 0 },
  ],
  missions: {
    solo: {
      rounds: 12,
      stableRounds: [11, 12],
      consumerDeadline: 8,
      planets: [
        {
          planetName: 'Helios',
          owner: 1,
          needByRound8: ['voltage', 'water'],
          startConsumer: 'voltage',
        },
      ],
    },
    coop: {
      rounds: 12,
      stableRounds: [11, 12],
      consumerDeadline: 8,
      planets: [
        {
          planetName: 'Helios',
          owner: 1,
          needByRound8: ['voltage', 'water'],
          startConsumer: 'voltage',
        },
        {
          planetName: 'Thalassa',
          owner: 2,
          needByRound8: ['heat', 'water'],
          startConsumer: 'heat',
        },
      ],
    },
  },
  freibeuters: [
    {
      id: 'F1',
      fee: 2,
      patrol: 'loop',
      startIndex: 0,
      startDir: 1,
      route: [
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 },
        { q: 1, r: 0 },
        { q: 0, r: 0 },
      ],
    },
    {
      id: 'F2',
      fee: 2,
      patrol: 'loop',
      startIndex: 0,
      startDir: 1,
      route: [
        { q: 3, r: 0 },
        { q: 3, r: -1 },
        { q: 2, r: -1 },
        { q: 2, r: 0 },
      ],
    },
  ],
  cells: [
    c(-3, 0),
    c(-3, 1, 'sun'),
    c(-3, 2),
    c(-3, 3),
    c(-2, -1),
    c(-2, 0, 'planet', { planetName: 'Helios' }),
    c(-2, 1, 'empty', { factory: 'solar' }),
    c(-2, 2),
    c(-2, 3),
    c(-1, -2, 'mountain'),
    c(-1, -1),
    c(-1, 0, 'empty', { factory: 'pumped' }),
    c(-1, 1),
    c(-1, 2),
    c(-1, 3),
    c(0, -3),
    c(0, -2),
    c(0, -1),
    c(0, 0, 'water'),
    c(0, 1),
    c(0, 2),
    c(0, 3),
    c(1, -3),
    c(1, -2),
    c(1, -1),
    c(1, 0, 'empty', { factory: 'transformer' }),
    c(1, 1),
    c(1, 2, 'mountain'),
    c(2, -3),
    c(2, -2),
    c(2, -1, 'empty', { factory: 'thermalCell' }),
    c(2, 0, 'planet', { planetName: 'Thalassa' }),
    c(2, 1),
    c(3, -3),
    c(3, -2),
    c(3, -1, 'sun'),
    c(3, 0),
  ],
}

/**
 * Kanalwelt — rules §11 B: U-shaped arms with northern corridor.
 */
const canal: Scenario = {
  id: 'canal',
  name: 'Kanalwelt',
  blurb:
    'U-Form: unten die Kolonien, oben der Verbindungskorridor. Wasser und Sonne je Arm, Uran und Speicher im Norden.',
  playerCount: 2,
  modes: ['solo', 'coop', 'versus'],
  focus: 'Lange Wasserwege',
  spawns: [
    { q: -3, r: 2 },
    { q: 3, r: 2 },
  ],
  missions: {
    solo: {
      rounds: 12,
      stableRounds: [11, 12],
      consumerDeadline: 8,
      planets: [
        {
          planetName: 'Neptis',
          owner: 1,
          needByRound8: ['voltage', 'water'],
          startConsumer: 'voltage',
        },
      ],
    },
    coop: {
      rounds: 12,
      stableRounds: [11, 12],
      consumerDeadline: 8,
      planets: [
        {
          planetName: 'Neptis',
          owner: 1,
          needByRound8: ['voltage', 'water'],
          startConsumer: 'voltage',
        },
        {
          planetName: 'Pyra',
          owner: 2,
          needByRound8: ['heat', 'water'],
          startConsumer: 'heat',
        },
      ],
    },
  },
  freibeuters: [
    {
      id: 'F1',
      fee: 2,
      patrol: 'pendulum',
      startIndex: 7,
      startDir: -1,
      route: [
        { q: -3, r: 2 },
        { q: -3, r: 1 },
        { q: -3, r: 0 },
        { q: -3, r: -1 },
        { q: -3, r: -2 },
        { q: -2, r: -2 },
        { q: -1, r: -2 },
        { q: 0, r: -2 },
        { q: 1, r: -2 },
        { q: 2, r: -2 },
        { q: 3, r: -2 },
        { q: 3, r: -1 },
        { q: 3, r: 0 },
        { q: 3, r: 1 },
        { q: 3, r: 2 },
      ],
    },
    {
      id: 'F2',
      fee: 3,
      patrol: 'pendulum',
      startIndex: 9,
      startDir: 1,
      route: [
        { q: -3, r: 2 },
        { q: -3, r: 1 },
        { q: -3, r: 0 },
        { q: -3, r: -1 },
        { q: -3, r: -2 },
        { q: -2, r: -2 },
        { q: -1, r: -2 },
        { q: 0, r: -2 },
        { q: 1, r: -2 },
        { q: 2, r: -2 },
        { q: 3, r: -2 },
        { q: 3, r: -1 },
        { q: 3, r: 0 },
        { q: 3, r: 1 },
        { q: 3, r: 2 },
      ],
    },
  ],
  cells: [
    c(-3, -2, 'water'),
    c(-2, -2),
    c(-1, -2),
    c(0, -2, 'empty', { factory: 'pumped' }),
    c(1, -2),
    c(2, -2),
    c(3, -2, 'water'),
    c(-3, -1),
    c(-2, -1, 'empty', { factory: 'transformer' }),
    c(-1, -1, 'empty', { factory: 'nuclearPlant' }),
    c(0, -1, 'uranium'),
    c(1, -1, 'empty', { factory: 'turbine' }),
    c(2, -1),
    c(3, -1),
    c(-3, 0),
    c(-2, 0),
    c(2, 0),
    c(3, 0),
    c(-3, 1, 'sun'),
    c(-2, 1, 'empty', { factory: 'solar' }),
    c(2, 1, 'empty', { factory: 'thermalCell' }),
    c(3, 1, 'sun'),
    c(-3, 2),
    c(-2, 2, 'planet', { planetName: 'Neptis' }),
    c(2, 2, 'planet', { planetName: 'Pyra' }),
    c(3, 2),
  ],
}

/**
 * Triade (3P) — every arm has a sun, no water anywhere.
 * Uranium sits in the contested center.
 */
const triad: Scenario = {
  id: 'triad',
  name: 'Triade',
  blurb:
    'Drei Arme mit je einer Sonne, aber verschiedenen Fabriken. Kein Wasser. Das Uran liegt umkämpft in der Mitte.',
  playerCount: 3,
  modes: ['versus'],
  focus: 'Sonne je Arm · Uran in der Mitte',
  spawns: [
    { q: 0, r: 4 },
    { q: 4, r: -4 },
    { q: -4, r: 0 },
  ],
  cells: dedupe([
    // —— Center contested ——
    c(0, 0, 'uranium'),
    c(0, 1, 'empty', { factory: 'transformer' }),
    c(1, 0, 'empty'),
    c(-1, 0, 'empty'),
    c(0, -1, 'empty'),
    c(1, -1, 'mountain'),
    c(-1, 1, 'mountain'),
    // —— South arm (P1) ——
    c(0, 2, 'empty'),
    c(0, 3, 'sun'),
    c(1, 2, 'empty'),
    c(0, 4),
    c(-1, 3, 'empty', { factory: 'solar' }),
    c(1, 3, 'empty', { factory: 'thermalCell' }),
    c(-1, 4, 'planet', { planetName: 'Auster' }),
    c(1, 4, 'empty'),
    c(0, 5, 'mountain'),
    c(-1, 2, 'empty'),
    // —— NE arm (P2) ——
    c(2, -1, 'empty'),
    c(2, -2, 'empty'),
    c(3, -2, 'sun'),
    c(4, -4),
    c(3, -3, 'empty'),
    c(3, -4, 'empty', { factory: 'turbine' }),
    c(4, -3, 'empty', { factory: 'pumped' }),
    c(4, -2, 'planet', { planetName: 'Vega' }),
    c(2, -3, 'empty'),
    c(5, -4, 'mountain'),
    c(5, -3, 'empty'),
    // —— NW arm (P3) ——
    c(-2, 0, 'empty'),
    c(-3, 0, 'sun'),
    c(-3, 1, 'empty', { factory: 'nuclearPlant' }),
    c(-4, 0),
    c(-4, 1, 'empty'),
    c(-2, -1, 'empty'),
    c(-4, -1, 'planet', { planetName: 'Lyra' }),
    c(-3, -1, 'empty'),
    c(-5, 0, 'mountain'),
    c(-5, 1, 'empty'),
    c(-2, 1, 'empty'),
  ]),
}

/**
 * King of the Hill (4P) — player 4 starts in a walled three-hex center.
 * Three roads leave the center; transformer, storage and sun sit just outside.
 * Each road ends at an outer player with planet, water and a converter.
 */
const kingOfTheHill: Scenario = {
  id: 'king-of-the-hill',
  name: 'King of the Hill',
  blurb:
    'Lila sitzt im ummauerten Zentrum neben Trafo, Speicher und Sonne. Drei Wege führen zu den anderen: je ein Planet, ein Wasser und eine Fabrik am Ende.',
  playerCount: 4,
  modes: ['versus'],
  focus: 'Zentrum gegen drei Außenposten',
  spawns: [
    { q: 0, r: -6 },
    { q: 7, r: 0 },
    { q: -6, r: 7 },
    { q: 0, r: 0 },
  ],
  cells: [
    // —— Walled center: three open hexes, three gaps toward the roads ——
    c(0, 0),
    c(1, 0),
    c(0, 1),
    c(1, -1, 'mountain'),
    c(2, -1, 'mountain'),
    c(-1, 0, 'mountain'),
    c(-1, 1, 'mountain'),
    c(1, 1, 'mountain'),
    c(0, 2, 'mountain'),
    // —— North road (Weiß) ——
    c(0, -1),
    c(-1, -1, 'empty', { factory: 'transformer' }),
    c(0, -2),
    c(0, -3),
    c(0, -4),
    c(0, -5),
    c(0, -6),
    c(1, -6),
    c(0, -7),
    c(-1, -6, 'planet', { planetName: 'Nordwacht' }),
    c(-1, -7, 'water'),
    c(1, -7, 'empty', { factory: 'solar' }),
    // —— East road (Schwarz) ——
    c(2, 0),
    c(3, -1, 'empty', { factory: 'pumped' }),
    c(3, 0),
    c(4, 0),
    c(5, 0),
    c(6, 0),
    c(7, 0),
    c(6, 1),
    c(8, 0),
    c(8, -1, 'planet', { planetName: 'Ostwacht' }),
    c(9, -1, 'water'),
    c(7, 1, 'empty', { factory: 'solar' }),
    // —— Southwest road (Grün) ——
    c(-1, 2),
    c(-1, 3, 'sun'),
    c(-2, 3),
    c(-3, 4),
    c(-4, 5),
    c(-5, 6),
    c(-6, 7),
    c(-6, 6),
    c(-7, 8),
    c(-6, 8, 'planet', { planetName: 'Südwacht' }),
    c(-7, 9, 'water'),
    c(-7, 7, 'empty', { factory: 'thermalCell' }),
  ],
}

export const SCENARIOS: Scenario[] = [twinSuns, canal, triad, kingOfTheHill]

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

export function bankForPlayers(n: number): number {
  return 60 * n
}

function emptyCell(hex: Axial): CellState {
  return {
    hex: { ...hex },
    revealed: true,
    terrain: 'empty',
    voltage: 0,
    water: 0,
    heat: 0,
    consumers: [],
    sourceStock: [],
    extractors: 0,
  }
}

function neutralField(kind: FieldKind): PlacedField {
  return {
    kind,
    owner: null,
    charge: [],
    fee: 0,
  }
}

/** Fully revealed board from a scenario definition. */
export function cellsFromScenario(
  scenario: Scenario,
): { cells: Record<string, CellState>; logLines: string[] } {
  const cells: Record<string, CellState> = {}
  const logLines: string[] = []
  for (const sc of scenario.cells) {
    const hex = { q: sc.q, r: sc.r }
    const key = hexKey(hex)
    const base = emptyCell(hex)
    base.terrain = sc.terrain
    if (sc.terrain === 'planet') {
      base.planetName = sc.planetName ?? `Planet (${sc.q},${sc.r})`
    }
    if (sc.factory) {
      base.field = neutralField(sc.factory)
      logLines.push(
        `${FIELD_DEFS[sc.factory].name} bei (${sc.q},${sc.r})`,
      )
    } else if (sc.terrain === 'sun' || sc.terrain === 'water' || sc.terrain === 'uranium') {
      logLines.push(
        `${sc.terrain === 'sun' ? 'Sonne' : sc.terrain === 'water' ? 'Wasser' : 'Uran'} bei (${sc.q},${sc.r})`,
      )
    } else if (sc.terrain === 'planet') {
      logLines.push(`${base.planetName} bei (${sc.q},${sc.r})`)
    }
    cells[key] = base
  }
  for (const spawn of scenario.spawns) {
    const key = hexKey(spawn)
    if (!cells[key]) cells[key] = emptyCell(spawn)
    else {
      cells[key] = {
        ...cells[key],
        terrain: 'empty',
        field: undefined,
        planetName: undefined,
        sourceStock: [],
        extractors: 0,
      }
    }
  }
  return { cells, logLines }
}

function findPlanetByName(
  cells: Record<string, CellState>,
  name: string,
): CellState | null {
  for (const cell of Object.values(cells)) {
    if (cell.terrain === 'planet' && cell.planetName === name) return cell
  }
  return null
}

function nearestOwnedCandidate(
  cells: Record<string, CellState>,
  from: Axial,
  match: (cell: CellState) => boolean,
): CellState | null {
  let best: CellState | null = null
  let bestDist = Infinity
  for (const cell of Object.values(cells)) {
    if (!match(cell)) continue
    const d = hexDistance(from, cell.hex)
    if (d < bestDist) {
      best = cell
      bestDist = d
    }
  }
  return best
}

/**
 * Solo/Koop setup: claim mission planets (with start consumer), a nearby
 * source with one extractor, a nearby factory, and red routes between
 * any adjacent pairs of those three.
 */
export function applySoloCoopStart(
  cells: Record<string, CellState>,
  mission: ScenarioMission,
  mintId: (prefix: string) => string,
): { cells: Record<string, CellState>; routes: Record<string, Route>; logLines: string[] } {
  let next = { ...cells }
  const routes: Record<string, Route> = {}
  const logLines: string[] = []

  for (const spec of mission.planets) {
    const planet = findPlanetByName(next, spec.planetName)
    if (!planet) continue
    const pKey = hexKey(planet.hex)
    const consumer = {
      id: mintId('cons'),
      type: spec.startConsumer,
      approver: spec.owner,
    }
    next[pKey] = {
      ...planet,
      planetOwner: spec.owner,
      consumers: [consumer],
      importFee: 0,
    }
    logLines.push(
      `${playerLabelSafe(spec.owner)} startet mit ${spec.planetName} (${spec.startConsumer}).`,
    )

    const preferredTerrain =
      spec.startConsumer === 'voltage' || spec.startConsumer === 'heat'
        ? 'sun'
        : 'water'
    const source =
      nearestOwnedCandidate(
        next,
        planet.hex,
        (cell) =>
          cell.terrain === preferredTerrain && cell.sourceOwner == null,
      ) ||
      nearestOwnedCandidate(
        next,
        planet.hex,
        (cell) =>
          (cell.terrain === 'sun' ||
            cell.terrain === 'water' ||
            cell.terrain === 'uranium') &&
          cell.sourceOwner == null,
      )
    if (source) {
      const sKey = hexKey(source.hex)
      next[sKey] = {
        ...next[sKey],
        sourceOwner: spec.owner,
        extractors: 1,
        sourceFee: 0,
      }
      logLines.push(
        `${playerLabelSafe(spec.owner)} erhält Quelle (${source.hex.q},${source.hex.r}) mit Extraktor.`,
      )
    }

    const preferredKind: FieldKind | null =
      spec.startConsumer === 'voltage'
        ? 'solar'
        : spec.startConsumer === 'heat'
          ? 'thermalCell'
          : null
    const factory =
      (preferredKind &&
        nearestOwnedCandidate(
          next,
          planet.hex,
          (cell) =>
            cell.field?.kind === preferredKind && cell.field.owner == null,
        )) ||
      nearestOwnedCandidate(
        next,
        planet.hex,
        (cell) => cell.field != null && cell.field.owner == null,
      )
    if (factory?.field) {
      const fKey = hexKey(factory.hex)
      next[fKey] = {
        ...next[fKey],
        field: { ...factory.field, owner: spec.owner, fee: 0 },
      }
      logLines.push(
        `${playerLabelSafe(spec.owner)} erhält ${FIELD_DEFS[factory.field.kind].name}.`,
      )
    }

    const hubs = [planet.hex]
    if (source) hubs.push(source.hex)
    if (factory) hubs.push(factory.hex)
    for (let i = 0; i < hubs.length; i++) {
      for (let j = i + 1; j < hubs.length; j++) {
        if (hexDistance(hubs[i]!, hubs[j]!) !== 1) continue
        const key = edgeKey(hubs[i]!, hubs[j]!)
        routes[key] = { owner: spec.owner, tier: 'red', fee: 0 }
      }
    }
  }

  return { cells: next, routes, logLines }
}

function playerLabelSafe(p: PlayerId): string {
  return ({ 1: 'Weiß', 2: 'Schwarz', 3: 'Grün', 4: 'Lila' } as const)[p]
}

/** True when every meter on the mission planet is within −3…+3. */
export function missionPlanetStable(cell: CellState): boolean {
  return (
    Math.abs(cell.voltage) <= 3 &&
    Math.abs(cell.water) <= 3 &&
    Math.abs(cell.heat) <= 3
  )
}

export function missionConsumersReady(
  cell: CellState,
  need: MeterKind[],
): boolean {
  const kinds = new Set(cell.consumers.map((c) => c.type))
  return need.every((k) => kinds.has(k))
}
