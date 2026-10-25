import type {
  Chip,
  ChipColor,
  ChipResource,
  PlacedField,
  PlayerId,
  PlayerState,
  RouteTier,
} from '../types'

/** Blue carries 1, purple 2, red 3. */
export const CHIP_ENERGY: Record<ChipColor, number> = {
  blue: 1,
  purple: 2,
  red: 3,
}

export const ROUTE_BUILD_COST: Record<RouteTier, number> = {
  blue: 2,
  purple: 4,
  red: 6,
}

export const TIER_LABEL: Record<RouteTier, string> = {
  blue: 'Blau',
  purple: 'Lila',
  red: 'Rot',
}

const TIER_RANK: Record<RouteTier, number> = {
  blue: 0,
  purple: 1,
  red: 2,
}

export function feeAmount(fee: number | undefined): number {
  if (fee == null || !Number.isFinite(fee)) return 0
  return Math.max(0, Math.floor(fee))
}

/** Blue links carry blue chips, purple carries blue and purple, red carries every color. */
export function tierAllows(tier: RouteTier, color: ChipColor): boolean {
  if (tier === 'red') return true
  if (tier === 'purple') return color !== 'red'
  return color === 'blue'
}

/** Money to raise a link. One step costs 2, two steps cost 4. */
export function upgradeCost(from: RouteTier, to: RouteTier): number | null {
  if (TIER_RANK[to] <= TIER_RANK[from]) return null
  return (TIER_RANK[to] - TIER_RANK[from]) * 2
}

export function canAfford(
  players: Record<PlayerId, PlayerState>,
  payer: PlayerId,
  owner: PlayerId,
  fee: number,
): boolean {
  if (fee <= 0 || payer === owner) return true
  return players[payer].money >= fee
}

/** Player-to-player fee. Using your own link, source or factory is free. */
export function payPlayer(
  players: Record<PlayerId, PlayerState>,
  payer: PlayerId,
  owner: PlayerId,
  fee: number,
): Record<PlayerId, PlayerState> | null {
  if (!canAfford(players, payer, owner, fee)) return null
  if (fee <= 0 || payer === owner) return players
  return {
    ...players,
    [payer]: { ...players[payer], money: players[payer].money - fee },
    [owner]: { ...players[owner], money: players[owner].money + fee },
  }
}

export type FactoryEffect =
  | { type: 'convert'; resource: ChipResource; label: string }
  | { type: 'store-water'; label: string }
  | { type: 'store-player'; label: string }
  | { type: 'turbine-split'; label: string }
  | { type: 'trafo-split'; label: string }

/**
 * Optional effect when the chip's owner chooses to trigger an active factory.
 * Passing through without paying is always allowed and is not an effect.
 */
export function factoryEffect(field: PlacedField, chip: Chip): FactoryEffect | null {
  if (field.owner == null) return null
  const resource = chip.resource
  const charge = field.charge.length
  switch (field.kind) {
    case 'solar':
      return resource === 'light'
        ? { type: 'convert', resource: 'voltage', label: 'Licht wird Spannung, Farbe bleibt' }
        : null
    case 'thermalCell':
      return resource === 'light'
        ? { type: 'convert', resource: 'heat', label: 'Licht wird Wärme, Farbe bleibt' }
        : null
    case 'nuclearPlant':
      return resource === 'uranium'
        ? { type: 'convert', resource: 'heat', label: 'Uran wird Wärme, Farbe bleibt' }
        : null
    case 'turbine':
      if (resource === 'heat' && charge > 0) {
        return {
          type: 'turbine-split',
          label: 'Wärme und eine Wasserladung werden zwei Spannungschips',
        }
      }
      if (resource === 'water' && charge < 4) {
        return { type: 'store-water', label: 'Wasser einlagern' }
      }
      return null
    case 'pumped':
      if (
        charge === 0 &&
        (resource === 'water' || resource === 'voltage' || resource === 'heat')
      ) {
        return { type: 'store-player', label: 'Chip einlagern' }
      }
      return null
    case 'transformer':
      if (resource === 'voltage' && charge > 0) {
        return {
          type: 'trafo-split',
          label: 'Gespeicherte Spannung zusätzlich freisetzen',
        }
      }
      return null
    default:
      return null
  }
}

export function supplyResource(resource: ChipResource | undefined): boolean {
  return resource === 'voltage' || resource === 'water' || resource === 'heat'
}
