import type {
  BeetKind,
  FieldKind,
  PlayerId,
  Recipe,
  ScenarioDef,
  ScenarioField,
  ScenarioId,
  Suit,
} from '../types'
import { BEET_DEFS, sourceLabel, storageLabel } from '../types'

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
 * Brettzeilen: Felder → Küchen|Infrastruktur → Ernte|Markt.
 * Beet und Regen kommen persönlich je Spieler (nicht aus dem Katalog).
 */
export const ROW = {
  source: 0,
  factory: 1,
  storage: 1,
  victory: 2,
  market: 2,
} as const

export function rowForKind(kind: FieldKind): number {
  return ROW[kind]
}

/** Beet: 1 Wasser + 1 Saat → Beet-Ernte */
export const RECIPE_KREUZ: Recipe = { energy: 1, hearts: 1 }

export function recipeForFactory(suit: Suit): Recipe | undefined {
  if (suit === 'clubs' || suit === 'berry' || suit === 'veg' || suit === 'herb') {
    return RECIPE_KREUZ
  }
  return undefined
}

/** Gemeinschaftliche Startquellen (Saatstand). Regen persönlich. */
function sources(heartsCount: number): ScenarioField[] {
  const out: ScenarioField[] = []
  for (let i = 1; i <= heartsCount; i++) {
    out.push({
      id: `herz-${i}`,
      kind: 'source',
      suit: 'hearts',
      label: sourceLabel('hearts', i),
      row: ROW.source,
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

export function personalGardenBeetLabel(
  playerId: PlayerId,
  kind: BeetKind,
  multi: boolean,
): string {
  const base = BEET_DEFS[kind].label
  return multi ? `${PLAYER_META[playerId].short}·${base}` : base
}

export function personalRegenLabel(
  playerId: PlayerId,
  multi: boolean,
): string {
  const base = sourceLabel('energy')
  return multi ? `${PLAYER_META[playerId].short}·${base}` : base
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'A',
    name: 'Allein im Garten',
    players: ['white'],
    description:
      '1 Spieler · 24 Karten/Sorte · 1 Saatstand, Regen, Apfelbeet, Schuppen, 3 Erntefelder. SP nach Zugende mit 3 vollen Stapeln.',
    beetsPerPlayer: 1,
    cardsPerSuit: 24,
    fields: [...sources(1)],
  },
  {
    id: 'B',
    name: 'Nachbarschaftsmarkt',
    players: ['white', 'black'],
    description:
      '2 Spieler · 48 Karten/Sorte · 1 Saatstand; Weiß Apfelbeet, Schwarz Beerenbeet; je Regen/Schuppen/3 Erntefelder. SP nach Zugende mit 3 vollen Stapeln.',
    beetsPerPlayer: 1,
    cardsPerSuit: 48,
    fields: [...sources(1)],
  },
  {
    id: 'C',
    name: 'Erntefest',
    players: ['white', 'black', 'red'],
    description:
      '3 Spieler · 72 Karten/Sorte · 1 Saatstand; Beete Obst/Beeren/Gemüse; je Regen/Schuppen/3 Erntefelder. SP nach Zugende mit 3 vollen Stapeln.',
    beetsPerPlayer: 1,
    cardsPerSuit: 72,
    fields: [...sources(1)],
  },
  {
    id: 'D',
    name: 'Großer Wochenmarkt',
    players: ['white', 'black', 'red', 'green'],
    description:
      '4 Spieler · 96 Karten/Sorte · 2 Saatstände; Beete aller vier Sorten; je Regen/Schuppen/3 Erntefelder. SP nach Zugende mit 3 vollen Stapeln.',
    beetsPerPlayer: 1,
    cardsPerSuit: 96,
    fields: [...sources(2)],
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
  const garden =
    /^beet-(apfel|beere|gemuese|kraut)-(white|black|red|green)$/.exec(fieldId)
  if (garden) {
    const multi = getScenario(scenarioId).players.length > 1
    return personalGardenBeetLabel(
      garden[2] as PlayerId,
      garden[1] as BeetKind,
      multi,
    )
  }
  const regen = /^regen-(white|black|red|green)$/.exec(fieldId)
  if (regen) {
    const multi = getScenario(scenarioId).players.length > 1
    return personalRegenLabel(regen[1] as PlayerId, multi)
  }
  const harvest = /^sieg-(white|black|red|green)-(\d+)$/.exec(fieldId)
  if (harvest) {
    const multi = getScenario(scenarioId).players.length > 1
    const base = `Ernte ${harvest[2]}`
    return multi ? `${PLAYER_META[harvest[1] as PlayerId].short}·${base}` : base
  }
  if (fieldId.startsWith('markt-')) {
    const m = /^markt-(2|4|6)$/.exec(fieldId)
    return m ? `${m[1]}¤` : 'Markt'
  }
  if (fieldId === 'wasserhandel-1' || fieldId.startsWith('wasserhandel-')) {
    return 'Wasserhandel'
  }
  return fieldId
}
