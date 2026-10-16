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
    blurb: 'Alles: Chip fliegt in beliebige Richtung weiter.',
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
    blurb:
      'Licht → Spannung (Spieler wählt Richtung). Wärme/Spannung: Feld zerstört.',
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
    blurb:
      'Wie Solarzelle, erzeugt Wärme (Spieler wählt Richtung). Zerstört durch Wasser/Spannung (nicht Wärme).',
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
    blurb:
      'Uran → Wärme beliebiger Beutel-Farbe (Spieler wählt Richtung). Wasser/Spannung: Feld zerstört.',
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
      'Wärme bei Ladung>0: → Spannungen (Spieler wählt Richtung). Ohne Ladung: Würfel. Wasser: laden (<4) sonst Zufall. Spannung: Würfel (Feld bleibt).',
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
      'Wasser/Spannung/Wärme: leer wird Ladung, sonst geradeaus. Geladen: Besitzer darf die Ladung in eine Richtung schießen.',
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
      'Start: 4 Spannung. Geladen: 1→2 (Spieler wählt Richtung). Leer: Würfelrichtung.',
  },
}

export const MARKET_ORDER: FieldKind[] = [
  'divert',
  'solar',
  'thermalCell',
  'nuclearPlant',
  'turbine',
  'pumped',
  'transformer',
]
