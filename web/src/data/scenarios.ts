import type {
  FieldKind,
  PlayerId,
  Recipe,
  ScenarioDef,
  ScenarioField,
  ScenarioId,
  Suit,
} from '../types'
import { factoryLabel, sourceLabel, storageLabel } from '../types'

export const PLAYER_META: Record<
  PlayerId,
  { name: string; color: string; short: string }
> = {
  white: { name: 'Weiß', color: '#f7f2e8', short: 'W' },
  black: { name: 'Schwarz', color: '#3d4538', short: 'S' },
  red: { name: 'Rot', color: '#d45c5c', short: 'R' },
  green: { name: 'Grün', color: '#5a9e6f', short: 'G' },
}

/**
 * Brettzeilen: Felder|Regen → Küchen|Infrastruktur → Ernte.
 * Quelle (row 0): Saatstand/Getreide und Regen; Küche|Infrastruktur (row 1); Ernte (row 2).
 */
export const ROW = {
  source: 0,
  factory: 1,
  storage: 1,
  victory: 2,
} as const

export function rowForKind(kind: FieldKind): number {
  return ROW[kind]
}

const LETTERS = ['A', 'B', 'C', 'D']

/** Mehlmühle: 1 Wasser + 1 Getreide → 1 Mehl */
export const RECIPE_KARO: Recipe = { energy: 1, spades: 1 }
/** Beet: 1 Wasser + 1 Saat → 1 Obst */
export const RECIPE_KREUZ: Recipe = { energy: 1, hearts: 1 }
/** Konfitürenküche: 1 Obst + 1 Wasser → 1 Konfitüre */
export const RECIPE_STAHL: Recipe = { clubs: 1, energy: 1 }

export function recipeForFactory(suit: Suit): Recipe | undefined {
  if (suit === 'diamonds') return RECIPE_KARO
  if (suit === 'clubs') return RECIPE_KREUZ
  if (suit === 'steel') return RECIPE_STAHL
  return undefined
}

/** Startquellen. Getreidefeld ist käuflich und startet nicht mit. */
function sources(counts: {
  hearts?: number
  spades?: number
  energy?: number
}): ScenarioField[] {
  const out: ScenarioField[] = []
  for (let i = 1; i <= (counts.hearts ?? 0); i++) {
    out.push({
      id: `herz-${i}`,
      kind: 'source',
      suit: 'hearts',
      label: sourceLabel('hearts', i),
      row: ROW.source,
    })
  }
  for (let i = 1; i <= (counts.spades ?? 0); i++) {
    out.push({
      id: `pik-${i}`,
      kind: 'source',
      suit: 'spades',
      label: sourceLabel('spades', i),
      row: ROW.source,
    })
  }
  for (let i = 1; i <= (counts.energy ?? 0); i++) {
    out.push({
      id: `energie-${i}`,
      kind: 'source',
      suit: 'energy',
      label: sourceLabel('energy', i),
      row: ROW.source,
    })
  }
  return out
}

function factories(
  karoCount: number,
  kreuzCount: number,
  stahlCount = 0,
): ScenarioField[] {
  const out: ScenarioField[] = []
  for (let i = 0; i < karoCount; i++) {
    out.push({
      id: `karo-${LETTERS[i]!.toLowerCase()}`,
      kind: 'factory',
      suit: 'diamonds',
      label: factoryLabel('diamonds', LETTERS[i]),
      recipe: RECIPE_KARO,
      row: ROW.factory,
    })
  }
  for (let i = 0; i < kreuzCount; i++) {
    out.push({
      id: `kreuz-${LETTERS[i]!.toLowerCase()}`,
      kind: 'factory',
      suit: 'clubs',
      label: factoryLabel('clubs', LETTERS[i]),
      recipe: RECIPE_KREUZ,
      row: ROW.factory,
    })
  }
  for (let i = 0; i < stahlCount; i++) {
    out.push({
      id: `stahl-${LETTERS[i]!.toLowerCase()}`,
      kind: 'factory',
      suit: 'steel',
      label: factoryLabel('steel', LETTERS[i]),
      recipe: RECIPE_STAHL,
      row: ROW.factory,
    })
  }
  return out
}

/** Persönliches Schuppen-Label (mit Spielerkürzel bei mehreren Spielern). */
export function personalBeetLabel(
  playerId: PlayerId,
  index: number | undefined,
  multi: boolean,
): string {
  const base = storageLabel(undefined, index)
  return multi ? `${PLAYER_META[playerId].short}·${base}` : base
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'A',
    name: 'Allein im Garten',
    players: ['white'],
    description:
      '1 Spieler · 30 Karten/Sorte · Saatstand + Regen, Beet, 1 Schuppen. Ziel: eine Reihe aus Mehl, Obst und Konfitüre. Getreidefeld, Mehlmühle und Konfitürenküche käuflich (+).',
    beetsPerPlayer: 1,
    cardsPerSuit: 30,
    fields: [...sources({ hearts: 1, energy: 1 }), ...factories(0, 1)],
  },
  {
    id: 'B',
    name: 'Nachbarschaftsmarkt',
    players: ['white', 'black'],
    description:
      '2 Spieler · 60 Karten/Sorte · Saatstand, 2 Regen, Beet; je 1 Schuppen. Ziel: eine Reihe aus Mehl, Obst und Konfitüre. Getreidefeld, Mehlmühle und Konfitürenküche käuflich (+).',
    beetsPerPlayer: 1,
    cardsPerSuit: 60,
    fields: [...sources({ hearts: 1, energy: 2 }), ...factories(0, 1)],
  },
  {
    id: 'C',
    name: 'Erntefest',
    players: ['white', 'black', 'red'],
    description:
      '3 Spieler · 80 Karten/Sorte · je 3 Saatstände/Regen/Beete, je 1 Schuppen. Ziel: eine Reihe aus Mehl, Obst und Konfitüre. Getreidefeld, Mehlmühle und Konfitürenküche käuflich (+).',
    beetsPerPlayer: 1,
    cardsPerSuit: 80,
    fields: [...sources({ hearts: 3, energy: 3 }), ...factories(0, 3)],
  },
  {
    id: 'D',
    name: 'Großer Wochenmarkt',
    players: ['white', 'black', 'red', 'green'],
    description:
      '4 Spieler · 100 Karten/Sorte · je 4 Saatstände/Regen, 3 Beete, je 1 Schuppen. Ziel: eine Reihe aus Mehl, Obst und Konfitüre. Getreidefeld, Mehlmühle und Konfitürenküche käuflich (+).',
    beetsPerPlayer: 1,
    cardsPerSuit: 100,
    fields: [...sources({ hearts: 4, energy: 4 }), ...factories(0, 3)],
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

/** Anzeigename eines Feldes (Szenario-Katalog oder persönliche Infra-ID). */
export function fieldLabel(scenarioId: ScenarioId, fieldId: string): string {
  const field = getScenario(scenarioId).fields.find((f) => f.id === fieldId)
  if (field) return field.label
  const beet = /^lager-(white|black|red|green)-(\d+)$/.exec(fieldId)
  if (beet) {
    const multi = getScenario(scenarioId).players.length > 1
    return personalBeetLabel(beet[1] as PlayerId, Number(beet[2]), multi)
  }
  const harvest = /^sieg-(white|black|red|green)-(\d+)$/.exec(fieldId)
  if (harvest) {
    const multi = getScenario(scenarioId).players.length > 1
    const base = `Ernte ${harvest[2]}`
    return multi ? `${PLAYER_META[harvest[1] as PlayerId].short}·${base}` : base
  }
  return fieldId
}
