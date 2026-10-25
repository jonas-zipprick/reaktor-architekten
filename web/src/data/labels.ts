import type { MeterKind, PlayerId } from '../types'

/** UI colors / names for up to four seats. */
export const PLAYER_NAMES: Record<PlayerId, string> = {
  1: 'Weiß',
  2: 'Schwarz',
  3: 'Grün',
  4: 'Lila',
}

export function playerLabel(p: PlayerId): string {
  return PLAYER_NAMES[p]
}

export function playerFull(p: PlayerId): string {
  return `Spieler ${PLAYER_NAMES[p]}`
}

/** Spannung=Volt, Wasser=Liter, Wärme=Watt */
export const METER_SHORT: Record<MeterKind, string> = {
  voltage: 'V',
  water: 'L',
  heat: 'W',
}

export const METER_LABELS: Record<MeterKind, string> = {
  voltage: 'Spannung',
  water: 'Wasser',
  heat: 'Wärme',
}

export const RESOURCE_LABELS = {
  voltage: 'Spannung',
  water: 'Wasser',
  heat: 'Wärme',
  uranium: 'Uran',
  light: 'Licht',
} as const

export function formatMeter(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}
