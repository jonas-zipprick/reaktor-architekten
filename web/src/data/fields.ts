import type { FieldKind } from '../types'

/**
 * Field catalogue from gameRules.md §7.
 * Effects are NOT enforced; descriptions guide playtesting.
 */
export interface FieldDef {
  kind: FieldKind
  name: string
  short: string
  cost: number
  maxCharge: number | null
  /** Starting charge count when bought (e.g. transformer = 4) */
  startCharge: number
  /** What the charge slots hold, when that is not obvious from the count. */
  maxChargeNote?: string
  accent: string
  icon: string
  blurb: string
}

export const FIELD_DEFS: Record<FieldKind, FieldDef> = {
  divert: {
    kind: 'divert',
    name: 'Umleitung',
    short: 'Uml.',
    cost: 1,
    maxCharge: 0,
    startCharge: 0,
    accent: '#6b8f9e',
    icon: '↗',
    blurb: 'Gibt es in den aktuellen Regeln nicht. Chips wählen den Weg selbst.',
  },
  solar: {
    kind: 'solar',
    name: 'Solarzelle',
    short: 'Solar',
    cost: 2,
    maxCharge: 0,
    startCharge: 0,
    accent: '#d4a017',
    icon: '☀',
    blurb: 'Licht → Spannung. Die Farbe bleibt. Danach wählt der Besitzer den Weg.',
  },
  thermalCell: {
    kind: 'thermalCell',
    name: 'Thermische Zelle',
    short: 'Therm.',
    cost: 2,
    maxCharge: 0,
    startCharge: 0,
    accent: '#d4783a',
    icon: '🔆',
    blurb: 'Licht → Wärme. Die Farbe bleibt. Danach wählt der Besitzer den Weg.',
  },
  nuclearPlant: {
    kind: 'nuclearPlant',
    name: 'Atomkraftwerk',
    short: 'Atom',
    cost: 2,
    maxCharge: 0,
    startCharge: 0,
    accent: '#8a5a44',
    icon: '☢',
    blurb: 'Uran → Wärme. Die Farbe bleibt. Danach wählt der Besitzer den Weg.',
  },
  turbine: {
    kind: 'turbine',
    name: 'Turbine',
    short: 'Turb.',
    cost: 1,
    maxCharge: 4,
    startCharge: 0,
    maxChargeNote: '4 Wasser',
    accent: '#3d7a8c',
    icon: '⚙',
    blurb:
      'Speichert bis zu 4 Wasser. Wärme plus eine Wasserladung ergeben zwei Spannungschips in den Farben der beiden Eingänge.',
  },
  pumped: {
    kind: 'pumped',
    name: 'Speicher',
    short: 'Spei.',
    cost: 1,
    maxCharge: 1,
    startCharge: 0,
    maxChargeNote: '1 Wasser, Spannung oder Wärme',
    accent: '#2f6b7a',
    icon: '💧',
    blurb:
      'Speichert einen Chip Wasser, Spannung oder Wärme. Er bleibt Eigentum des Einlagerers und kann später kostenlos freigegeben werden.',
  },
  transformer: {
    kind: 'transformer',
    name: 'Trafo',
    short: 'Trafo',
    cost: 2,
    maxCharge: 4,
    startCharge: 4,
    maxChargeNote: '4 Spannung',
    accent: '#9a6b3a',
    icon: '⬡',
    blurb:
      'Start: 4 Spannung. Ein Spannungschip darf eine gespeicherte Spannung mitnehmen. Leer entsteht kein zweiter Chip.',
  },
}

export const MARKET_ORDER: FieldKind[] = [
  'solar',
  'thermalCell',
  'nuclearPlant',
  'turbine',
  'pumped',
  'transformer',
]
