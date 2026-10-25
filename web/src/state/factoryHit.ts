import type { Chip, ChipResource, DirIndex, PlacedField } from '../types'

/** How a flying chip meets a factory, before the fee choice. */
export type HitClass = 'straight' | 'paid'

/**
 * Money for filling a negative meter, one point of energy at a time.
 * Blue = 1, purple = 2, red = 3. Uses the meter value before the chip arrives.
 */
export function supplyPayout(before: number, energy: number): number {
  let sum = 0
  for (let i = 0; i < energy; i++) {
    sum += -Math.min(before + i, 0)
  }
  return sum
}

export function classifyFactoryHit(field: PlacedField, chip: Chip): HitClass {
  const resource = chip.resource
  const charge = field.charge.length
  switch (field.kind) {
    case 'divert':
      return 'paid'
    case 'solar':
    case 'thermalCell':
      return resource === 'light' ? 'paid' : 'straight'
    case 'nuclearPlant':
      return resource === 'uranium' ? 'paid' : 'straight'
    case 'turbine':
      if (resource === 'heat' || resource === 'water' || resource === 'voltage') {
        return 'paid'
      }
      return 'straight'
    case 'pumped':
      if (
        charge === 0 &&
        (resource === 'water' || resource === 'voltage' || resource === 'heat')
      ) {
        return 'paid'
      }
      return 'straight'
    case 'transformer':
      return resource === 'voltage' ? 'paid' : 'straight'
    default:
      return 'straight'
  }
}

const RESOURCE_NAME: Record<ChipResource, string> = {
  voltage: 'Spannung',
  water: 'Wasser',
  heat: 'Wärme',
  uranium: 'Uran',
  light: 'Licht',
}

export function resourceName(resource: ChipResource | undefined): string {
  return resource ? RESOURCE_NAME[resource] : 'Chip'
}

/** Short line for the pay button. Arrow, die and random are resolved on confirm. */
export function paidEffectLabel(field: PlacedField, chip: Chip): string {
  const resource = chip.resource
  const charge = field.charge.length
  switch (field.kind) {
    case 'divert':
      return 'fliegt in Pfeilrichtung'
    case 'solar':
      return 'Licht wird Spannung und fliegt in Pfeilrichtung'
    case 'thermalCell':
      return 'Licht wird Wärme und fliegt in Pfeilrichtung'
    case 'nuclearPlant':
      return 'Uran wird Wärme und fliegt in Pfeilrichtung'
    case 'turbine':
      if (resource === 'heat' && charge > 0) {
        return 'Wärme und 1 Wasser-Ladung werden Spannung und fliegen in Pfeilrichtung'
      }
      if (resource === 'heat') return 'Wärme fliegt in Würfelrichtung'
      if (resource === 'water' && charge < 4) return 'Wasser wird Ladung'
      if (resource === 'water') return 'Wasser fliegt in zufällige Richtung'
      return 'Spannung fliegt in Würfelrichtung'
    case 'pumped':
      return `${resourceName(resource)} wird Ladung`
    case 'transformer':
      return charge > 0
        ? 'Spannung verdoppelt sich und beide fliegen in Pfeilrichtung'
        : 'Spannung fliegt in Würfelrichtung'
    default:
      return 'Effekt'
  }
}

export function departureKind(
  field: PlacedField,
  chip: Chip,
): 'arrow' | 'die' | 'random' | 'store' | 'color' {
  const resource = chip.resource
  const charge = field.charge.length
  switch (field.kind) {
    case 'divert':
    case 'solar':
    case 'thermalCell':
      return 'arrow'
    case 'nuclearPlant':
      return 'arrow'
    case 'turbine':
      if (resource === 'heat' && charge > 0) return 'arrow'
      if (resource === 'heat') return 'die'
      if (resource === 'water' && charge < 4) return 'store'
      if (resource === 'water') return 'random'
      return 'die'
    case 'pumped':
      return 'store'
    case 'transformer':
      return charge > 0 ? 'arrow' : 'die'
    default:
      return 'arrow'
  }
}

export function clampFee(fee: number): number {
  if (!Number.isFinite(fee)) return 0
  return Math.max(0, Math.floor(fee))
}

export function rollDir(): DirIndex {
  return (Math.floor(Math.random() * 6) + 1) as DirIndex
}
