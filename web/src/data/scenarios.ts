import type { GameMode, PlayerId, ScenarioDef, ScenarioId } from '../types'

const playersForMode = (mode: GameMode, scenario: ScenarioId): PlayerId[] => {
  if (mode === 'solo') return ['white']
  if (scenario === 'C') return ['white', 'black', 'red']
  if (scenario === 'D') return ['white', 'black', 'red', 'green']
  return ['white', 'black']
}

export function playersFor(scenarioId: ScenarioId, mode: GameMode): PlayerId[] {
  return playersForMode(mode, scenarioId)
}

export const PLAYER_META: Record<
  PlayerId,
  { name: string; color: string; short: string }
> = {
  white: { name: 'Weiß', color: '#f4f0e8', short: 'W' },
  black: { name: 'Schwarz', color: '#2a3142', short: 'S' },
  red: { name: 'Rot', color: '#e85d4c', short: 'R' },
  green: { name: 'Grün', color: '#3cb88a', short: 'G' },
}

const polarityCells = (): ScenarioDef['cells'] => [
  { x: -4, y: -4, kind: 'planet', label: 'Planet A' },
  { x: 4, y: 4, kind: 'planet', label: 'Planet B' },
  { x: -4, y: 0, kind: 'sun', label: 'Westsonne' },
  { x: 4, y: 0, kind: 'sun', label: 'Ostsonne' },
  { x: -2, y: 0, kind: 'storage', label: 'Westspeicher' },
  { x: 2, y: 0, kind: 'storage', label: 'Ostspeicher' },
  { x: -1, y: -2, kind: 'asteroid' },
  { x: 1, y: 2, kind: 'asteroid' },
  { x: -4, y: 2, kind: 'base', label: 'Basis Weiß', owner: 'white' },
  { x: 4, y: 2, kind: 'base', label: 'Basis Schwarz', owner: 'black' },
]

const polarityDefenses = {
  solo: [
    { x: -3, y: -4, rank: 4 as const, toll: 2 },
    { x: -4, y: -3, rank: 5 as const, toll: 2 },
    { x: 0, y: 0, rank: 3 as const, toll: 3 },
  ],
  coop: [
    { x: -3, y: -4, rank: 4 as const, toll: 2 },
    { x: -4, y: -3, rank: 5 as const, toll: 2 },
    { x: 0, y: 0, rank: 3 as const, toll: 3 },
    { x: 3, y: 4, rank: 6 as const, toll: 3 },
    { x: 4, y: 3, rank: 4 as const, toll: 2 },
  ],
  versus: [] as { x: number; y: number; rank: 4 | 5 | 6 | 3; toll: number }[],
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'A',
    name: 'Polarität',
    modes: ['solo', 'coop', 'versus'],
    description:
      '9×9-Raster mit gegenüberliegenden Planeten. Klassisches Einstiegsszenario.',
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    cells: polarityCells(),
    defenses: polarityDefenses,
    missions: {
      solo: { planets: ['Planet A'], defenses: 1 },
      coop: { planets: ['Planet A', 'Planet B'], defenses: 2 },
    },
  },
  {
    id: 'B',
    name: 'Kanalwelt',
    modes: ['solo', 'coop', 'versus'],
    description:
      'U-förmiges Raster — enge Korridore und teure Mittelverteidigung.',
    cells: [
      // Left arm
      ...[-3, -2, -1, 0, 1, 2, 3].flatMap((y) => [
        { x: -5, y, kind: 'empty' as const },
        { x: -4, y, kind: 'empty' as const },
      ]),
      // Right arm
      ...[-3, -2, -1, 0, 1, 2, 3].flatMap((y) => [
        { x: 4, y, kind: 'empty' as const },
        { x: 5, y, kind: 'empty' as const },
      ]),
      // Top corridor
      ...[-3, -2, -1, 0, 1, 2, 3].flatMap((x) => [
        { x, y: -3, kind: 'empty' as const },
        { x, y: -2, kind: 'empty' as const },
      ]),
      { x: -5, y: 3, kind: 'planet', label: 'Planet A' },
      { x: 5, y: 3, kind: 'planet', label: 'Planet B' },
      { x: -5, y: 0, kind: 'sun', label: 'Westsonne' },
      { x: 5, y: 0, kind: 'sun', label: 'Ostsonne' },
      { x: -4, y: -1, kind: 'storage', label: 'Westspeicher' },
      { x: 4, y: -1, kind: 'storage', label: 'Ostspeicher' },
      { x: -5, y: -2, kind: 'base', label: 'Basis Weiß', owner: 'white' },
      { x: 5, y: -2, kind: 'base', label: 'Basis Schwarz', owner: 'black' },
    ],
    defenses: {
      solo: [
        { x: -5, y: 2, rank: 4, toll: 2 },
        { x: -4, y: 3, rank: 3, toll: 2 },
        { x: 0, y: -3, rank: 5, toll: 4 },
      ],
      coop: [
        { x: -5, y: 2, rank: 4, toll: 2 },
        { x: -4, y: 3, rank: 3, toll: 2 },
        { x: 0, y: -3, rank: 5, toll: 4 },
        { x: 5, y: 2, rank: 6, toll: 3 },
        { x: 4, y: 3, rank: 4, toll: 2 },
      ],
      versus: [],
    },
    missions: {
      solo: { planets: ['Planet A'], defenses: 1 },
      coop: { planets: ['Planet A', 'Planet B'], defenses: 2 },
    },
  },
  {
    id: 'C',
    name: 'Triade',
    modes: ['versus'],
    description: 'Drei Spieler, drei Planeten, drei Sonnen — offener Wettbewerb.',
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    cells: [
      { x: -4, y: -4, kind: 'planet', label: 'Planet Nordwest' },
      { x: 4, y: -4, kind: 'planet', label: 'Planet Nordost' },
      { x: 4, y: 4, kind: 'planet', label: 'Planet Südost' },
      { x: -4, y: 0, kind: 'sun', label: 'Westsonne' },
      { x: 0, y: -4, kind: 'sun', label: 'Nordsonne' },
      { x: 4, y: 0, kind: 'sun', label: 'Ostsonne' },
      { x: -2, y: 0, kind: 'storage', label: 'Westspeicher' },
      { x: 0, y: -2, kind: 'storage', label: 'Nordspeicher' },
      { x: 2, y: 0, kind: 'storage', label: 'Ostspeicher' },
      { x: -1, y: -1, kind: 'asteroid' },
      { x: 1, y: -1, kind: 'asteroid' },
      { x: -1, y: 2, kind: 'asteroid' },
      { x: 1, y: 2, kind: 'asteroid' },
      { x: -4, y: 2, kind: 'base', label: 'Basis Weiß', owner: 'white' },
      { x: -1, y: -4, kind: 'base', label: 'Basis Schwarz', owner: 'black' },
      { x: 4, y: 2, kind: 'base', label: 'Basis Rot', owner: 'red' },
    ],
    defenses: { solo: [], coop: [], versus: [] },
    missions: {
      solo: { planets: [], defenses: 0 },
      coop: { planets: [], defenses: 0 },
    },
  },
  {
    id: 'D',
    name: 'King of the Hill',
    modes: ['versus'],
    description: 'Vier Spieler um die Zentralsonne — enge Wege, viele Asteroiden.',
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    cells: [
      { x: -4, y: -4, kind: 'planet', label: 'Planet Nordwest' },
      { x: 4, y: -4, kind: 'planet', label: 'Planet Nordost' },
      { x: -4, y: 4, kind: 'planet', label: 'Planet Südwest' },
      { x: -4, y: 0, kind: 'sun', label: 'Westsonne' },
      { x: 0, y: -4, kind: 'sun', label: 'Nordsonne' },
      { x: 4, y: 0, kind: 'sun', label: 'Ostsonne' },
      { x: 0, y: 0, kind: 'sun', label: 'Zentralsonne' },
      { x: -3, y: 1, kind: 'storage', label: 'Westspeicher' },
      { x: 1, y: -2, kind: 'storage', label: 'Nordspeicher' },
      { x: 3, y: 1, kind: 'storage', label: 'Ostspeicher' },
      { x: -1, y: 1, kind: 'storage', label: 'Zentralspeicher' },
      { x: -2, y: -1, kind: 'asteroid' },
      { x: 2, y: -1, kind: 'asteroid' },
      { x: -2, y: 1, kind: 'asteroid' },
      { x: 2, y: 1, kind: 'asteroid' },
      { x: 0, y: -2, kind: 'asteroid' },
      { x: 0, y: 3, kind: 'asteroid' },
      { x: -4, y: 2, kind: 'base', label: 'Basis Weiß', owner: 'white' },
      { x: 1, y: -4, kind: 'base', label: 'Basis Schwarz', owner: 'black' },
      { x: 4, y: 2, kind: 'base', label: 'Basis Rot', owner: 'red' },
      { x: 0, y: 2, kind: 'base', label: 'Basis Grün', owner: 'green' },
    ],
    defenses: { solo: [], coop: [], versus: [] },
    missions: {
      solo: { planets: [], defenses: 0 },
      coop: { planets: [], defenses: 0 },
    },
  },
]

export function getScenario(id: ScenarioId): ScenarioDef {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown scenario ${id}`)
  return s
}
