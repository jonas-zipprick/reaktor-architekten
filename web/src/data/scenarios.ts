import type {
  FieldKind,
  PlayerId,
  Recipe,
  ScenarioDef,
  ScenarioField,
  ScenarioId,
  Suit,
} from '../types'

export const PLAYER_META: Record<
  PlayerId,
  { name: string; color: string; short: string }
> = {
  white: { name: 'Weiß', color: '#f4f0e8', short: 'W' },
  black: { name: 'Schwarz', color: '#2a3142', short: 'S' },
  red: { name: 'Rot', color: '#e85d4c', short: 'R' },
  green: { name: 'Grün', color: '#3cb88a', short: 'G' },
}

/**
 * Brettzeilen: Quellen → Fabriken|Infrastruktur (eine Zeile, zwei Spalten) → Märkte.
 * Fabrik und Infrastruktur teilen sich `row` 1; das Board rendert sie nebeneinander.
 */
export const ROW = {
  source: 0,
  factory: 1,
  storage: 1,
  market: 2,
} as const

export function rowForKind(kind: FieldKind): number {
  return ROW[kind]
}

const LETTERS = ['A', 'B', 'C', 'D']

/** Karofabrik: 1 Energie + 1 Pik → 1 ♦ */
export const RECIPE_KARO: Recipe = { energy: 1, spades: 1 }
/** Kreuzfabrik: 1 Energie + 1 Herz → 1 ♣ */
export const RECIPE_KREUZ: Recipe = { energy: 1, hearts: 1 }

export function recipeForFactory(suit: Suit): Recipe | undefined {
  if (suit === 'diamonds') return RECIPE_KARO
  if (suit === 'clubs') return RECIPE_KREUZ
  return undefined
}

function sources(perSuit: number): ScenarioField[] {
  const out: ScenarioField[] = []
  for (let i = 1; i <= perSuit; i++) {
    out.push({
      id: `herz-${i}`,
      kind: 'source',
      suit: 'hearts',
      label: `Herzquelle ${i}`,
      row: ROW.source,
    })
  }
  for (let i = 1; i <= perSuit; i++) {
    out.push({
      id: `pik-${i}`,
      kind: 'source',
      suit: 'spades',
      label: `Pikquelle ${i}`,
      row: ROW.source,
    })
  }
  for (let i = 1; i <= perSuit; i++) {
    out.push({
      id: `energie-${i}`,
      kind: 'source',
      suit: 'energy',
      label: `Energiequelle ${i}`,
      row: ROW.source,
    })
  }
  return out
}

function factories(karoCount: number, kreuzCount: number): ScenarioField[] {
  const out: ScenarioField[] = []
  for (let i = 0; i < karoCount; i++) {
    out.push({
      id: `karo-${LETTERS[i]!.toLowerCase()}`,
      kind: 'factory',
      suit: 'diamonds',
      label: `Karofabrik ${LETTERS[i]}`,
      recipe: RECIPE_KARO,
      row: ROW.factory,
    })
  }
  for (let i = 0; i < kreuzCount; i++) {
    out.push({
      id: `kreuz-${LETTERS[i]!.toLowerCase()}`,
      kind: 'factory',
      suit: 'clubs',
      label: `Kreuzfabrik ${LETTERS[i]}`,
      recipe: RECIPE_KREUZ,
      row: ROW.factory,
    })
  }
  return out
}

function storages(count: number): ScenarioField[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `lager-${i + 1}`,
    kind: 'storage' as const,
    label: `Lager ${i + 1}`,
    row: ROW.storage,
  }))
}

function market(suit: Suit, label: string): ScenarioField {
  return {
    id: `markt-${suit}`,
    kind: 'market',
    suit,
    label,
    row: ROW.market,
  }
}

const MARKT_HERZ = () => market('hearts', 'Herzmarkt')
const MARKT_PIK = () => market('spades', 'Pikmarkt')
const MARKT_KARO = () => market('diamonds', 'Karomarkt')
const MARKT_KREUZ = () => market('clubs', 'Kreuzmarkt')

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'A',
    name: 'Allein am Tisch',
    players: ['white'],
    description:
      '1 Spieler · Herz-/Energiequelle, 1 Lager, Kreuzfabrik + Kreuzmarkt. Ausbau 1: Energiemarkt · Ausbau 2: Pikquelle + Karofabrik + Karomarkt.',
    fields: [
      {
        id: 'herz-1',
        kind: 'source',
        suit: 'hearts',
        label: 'Herzquelle 1',
        row: ROW.source,
      },
      {
        id: 'energie-1',
        kind: 'source',
        suit: 'energy',
        label: 'Energiequelle 1',
        row: ROW.source,
      },
      ...storages(1),
      MARKT_KREUZ(),
      ...factories(0, 1),
    ],
  },
  {
    id: 'B',
    name: 'Privatisierung',
    players: ['white', 'black'],
    description:
      '2 Spieler · 2/2 Quellen, je 2 Fabriken, 2 Lager, Karo-/Kreuzmarkt.',
    fields: [
      ...sources(2),
      ...storages(2),
      MARKT_KARO(),
      MARKT_KREUZ(),
      ...factories(2, 2),
    ],
  },
  {
    id: 'C',
    name: 'Industrieller Wettbewerb',
    players: ['white', 'black', 'red'],
    description:
      '3 Spieler · 3/3 Quellen, je 3 Fabriken, 3 Lager, Herz-/Karo-/Kreuzmarkt.',
    fields: [
      ...sources(3),
      ...storages(3),
      MARKT_HERZ(),
      MARKT_KARO(),
      MARKT_KREUZ(),
      ...factories(3, 3),
    ],
  },
  {
    id: 'D',
    name: 'Oligarchen',
    players: ['white', 'black', 'red', 'green'],
    description:
      '4 Spieler · 4/4 Quellen, je 3 Fabriken, 4 Lager, alle 4 Märkte.',
    fields: [
      ...sources(4),
      ...storages(4),
      MARKT_HERZ(),
      MARKT_PIK(),
      MARKT_KARO(),
      MARKT_KREUZ(),
      ...factories(3, 3),
    ],
  },
]

export function getScenario(id: ScenarioId): ScenarioDef {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown scenario ${id}`)
  return s
}

export function playersFor(scenarioId: ScenarioId): PlayerId[] {
  return getScenario(scenarioId).players
}

export function fieldLabel(scenarioId: ScenarioId, fieldId: string): string {
  const field = getScenario(scenarioId).fields.find((f) => f.id === fieldId)
  return field?.label ?? fieldId
}
