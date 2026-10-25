import {
  CONSUMER_COST,
  CRITICAL_LIMIT,
  EXTRACTOR_COST,
  FACTORY_UPKEEP,
  TRAFO_RELOAD_COST,
} from '../data/boardLayout'
import { supplyPayout } from './factoryHit'
import {
  CHIP_ENERGY,
  factoryEffect,
  feeAmount,
  tierAllows,
} from './simRules'
import type { GameState } from './gameStore'
import {
  DIRECTIONS,
  type Axial,
  type Chip,
  type ChipColor,
  type ChipResource,
  type DirIndex,
  type FieldKind,
  type CellState,
  type MeterKind,
  type PlayerId,
  type RouteTier,
} from '../types'
import {
  dirBetween,
  edgeKey,
  hexDistance,
  hexEquals,
  hexKey,
  neighbor,
  parseEdgeKey,
  parseKey,
} from '../hex/math'

/**
 * One decision for the computer player.
 * The driver applies it through the same actions a person uses.
 */
export type AiAction =
  | { type: 'claimOffer'; id: string }
  | { type: 'declineOffer'; id: string }
  | { type: 'claimFacility'; hex: Axial }
  | { type: 'abandonFacility'; hex: Axial }
  | { type: 'buildExtractor'; hex: Axial }
  | { type: 'closeForUpkeep'; hex: Axial }
  | { type: 'moveShip'; hex: Axial }
  | { type: 'buildRoute'; hex: Axial; dir: DirIndex; tier: RouteTier }
  | { type: 'upgradeRoute'; hex: Axial; dir: DirIndex; tier: RouteTier }
  | { type: 'approveConsumer'; hex: Axial; meter: MeterKind }
  | { type: 'setSourceFee'; hex: Axial; fee: number }
  | { type: 'setFactoryFee'; hex: Axial; fee: number }
  | { type: 'setImportFee'; hex: Axial; fee: number }
  | { type: 'setRouteFee'; hex: Axial; dir: DirIndex; fee: number }
  | { type: 'recharge'; hex: Axial }
  | { type: 'endActions' }
  | { type: 'nextPhase' }
  | { type: 'takeSource'; hex: Axial; index: number }
  | { type: 'releaseStorage'; hex: Axial }
  | { type: 'followRoute'; dir: DirIndex }
  | { type: 'triggerFactory' }
  | { type: 'deliver'; payTariff: boolean }
  | { type: 'abort' }
  | { type: 'pass' }
  | { type: 'confirmHit' }
  | { type: 'declineHit' }
  | { type: 'pickColor'; color: ChipColor }

const SOURCE_RESOURCE: Record<string, ChipResource> = {
  uranium: 'uranium',
  sun: 'light',
  water: 'water',
}

type Step =
  | { kind: 'trigger' }
  | { kind: 'move'; dir: DirIndex }
  | { kind: 'deliver'; payTariff: boolean }

interface Plan {
  /** Higher is better. Money weighs most, then filling demand. */
  score: number
  profit: number
  steps: Step[]
}

function rivals(s: GameState, player: PlayerId): PlayerId[] {
  return s.playerIds.filter((id) => id !== player)
}

function occupiedByRival(s: GameState, player: PlayerId, hex: Axial): boolean {
  return rivals(s, player).some((id) => hexEquals(s.ships[id], hex))
}

function isSource(cell: CellState): boolean {
  return cell.terrain === 'sun' || cell.terrain === 'water' || cell.terrain === 'uranium'
}

function asMeter(resource: ChipResource): MeterKind | null {
  if (resource === 'voltage' || resource === 'water' || resource === 'heat') return resource
  return null
}

function upkeepDue(s: GameState, player: PlayerId): number {
  return factoryCount(s, player) * FACTORY_UPKEEP
}

function factoryCount(s: GameState, player: PlayerId): number {
  let n = 0
  for (const cell of Object.values(s.cells)) {
    if (cell.field?.owner === player) n += 1
  }
  return n
}

function ownsTerrain(s: GameState, player: PlayerId, terrain: CellState['terrain']): boolean {
  return Object.values(s.cells).some(
    (cell) => cell.sourceOwner === player && cell.terrain === terrain,
  )
}

function ownConsumerCount(s: GameState, player: PlayerId): number {
  let count = 0
  for (const cell of Object.values(s.cells)) {
    if (cell.planetOwner === player) count += cell.consumers.length
  }
  return count
}

/**
 * A converter for a source we already own is worth its upkeep.
 * Anything else waits until a consumer is running and money is comfortable.
 */
function usefulFactory(s: GameState, player: PlayerId, kind: FieldKind): boolean {
  const money = s.players[player].money
  const owned = factoryCount(s, player)
  const has = (next: FieldKind) => factoryHexes(s, player, next).length > 0
  const converter =
    ((kind === 'solar' || kind === 'thermalCell') &&
      ownsTerrain(s, player, 'sun') &&
      !has('solar') &&
      !has('thermalCell')) ||
    (kind === 'nuclearPlant' && ownsTerrain(s, player, 'uranium') && !has('nuclearPlant'))
  if (converter) return money >= (owned + 1) * FACTORY_UPKEEP + 6
  if (ownConsumerCount(s, player) === 0 || money < 14 || owned >= 3) return false
  if (money < (owned + 1) * FACTORY_UPKEEP + 8) return false
  if (kind === 'turbine') return ownsTerrain(s, player, 'water') && !has('turbine')
  if (kind === 'transformer') return !has('transformer')
  return false
}

function walkable(cell: CellState | undefined): boolean {
  return Boolean(cell?.revealed && cell.terrain !== 'mountain')
}

function pathBetween(
  cells: Record<string, CellState>,
  from: Axial,
  to: Axial,
): Axial[] | null {
  if (hexEquals(from, to)) return [from]
  const goal = hexKey(to)
  const prev = new Map<string, string | null>()
  const queue: Axial[] = [from]
  prev.set(hexKey(from), null)
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const d of DIRECTIONS) {
      const next = neighbor(cur, d.id)
      const key = hexKey(next)
      if (prev.has(key)) continue
      const cell = cells[key]
      if (!walkable(cell)) continue
      prev.set(key, hexKey(cur))
      if (key === goal) {
        const path: Axial[] = []
        let cursor: string | null = goal
        while (cursor) {
          path.push(parseKey(cursor))
          cursor = prev.get(cursor) ?? null
        }
        path.reverse()
        return path
      }
      queue.push(next)
    }
  }
  return null
}

function chain(cells: Record<string, CellState>, points: Axial[]): Axial[] | null {
  const full: Axial[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const part = pathBetween(cells, points[i], points[i + 1])
    if (!part) return null
    if (i === 0) full.push(...part)
    else full.push(...part.slice(1))
  }
  return full
}

function nearestHex(
  cells: Record<string, CellState>,
  from: Axial,
  options: Axial[],
): Axial | null {
  let best: { hex: Axial; len: number } | null = null
  for (const hex of options) {
    const path = pathBetween(cells, from, hex)
    if (!path) continue
    if (!best || path.length < best.len) best = { hex, len: path.length }
  }
  return best?.hex ?? null
}

function factoryHexes(s: GameState, player: PlayerId, kind: FieldKind): Axial[] {
  const hexes: Axial[] = []
  for (const cell of Object.values(s.cells)) {
    if (cell.field?.owner === player && cell.field.kind === kind) hexes.push(cell.hex)
  }
  return hexes
}

function meterNeed(s: GameState, player: PlayerId, meter: MeterKind): number {
  let need = 0
  for (const cell of Object.values(s.cells)) {
    if (cell.planetOwner !== player || cell.terrain !== 'planet') continue
    need += Math.max(0, -cell[meter])
    if (cell.consumers.some((c) => c.type === meter)) need += 3
  }
  return need
}

function outputPlan(
  s: GameState,
  player: PlayerId,
  source: CellState,
): { resource: MeterKind; via: Axial | null } | null {
  if (source.terrain === 'water') return { resource: 'water', via: null }
  if (source.terrain === 'sun') {
    const solar = nearestHex(s.cells, source.hex, factoryHexes(s, player, 'solar'))
    const thermal = nearestHex(s.cells, source.hex, factoryHexes(s, player, 'thermalCell'))
    if (solar && thermal) {
      return meterNeed(s, player, 'voltage') >= meterNeed(s, player, 'heat')
        ? { resource: 'voltage', via: solar }
        : { resource: 'heat', via: thermal }
    }
    if (solar) return { resource: 'voltage', via: solar }
    if (thermal) return { resource: 'heat', via: thermal }
    return null
  }
  if (source.terrain === 'uranium') {
    const nuclear = nearestHex(s.cells, source.hex, factoryHexes(s, player, 'nuclearPlant'))
    if (!nuclear) return null
    return { resource: 'heat', via: nuclear }
  }
  return null
}

function supplyableMeters(s: GameState, player: PlayerId): MeterKind[] {
  const found = new Set<MeterKind>()
  for (const cell of Object.values(s.cells)) {
    if (cell.sourceOwner !== player || !isSource(cell)) continue
    const plan = outputPlan(s, player, cell)
    if (plan) found.add(plan.resource)
  }
  return [...found]
}

interface MissingEdge {
  a: Axial
  b: Axial
  dir: DirIndex
}

function missingEdges(s: GameState, path: Axial[]): MissingEdge[] {
  const missing: MissingEdge[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    if (s.routes[edgeKey(a, b)]) continue
    const dir = dirBetween(a, b)
    if (!dir) continue
    missing.push({ a, b, dir })
  }
  return missing
}

interface Project {
  path: Axial[]
  missing: MissingEdge[]
}

function supplyProject(s: GameState, player: PlayerId): Project | null {
  const planets = Object.values(s.cells).filter(
    (cell) => cell.terrain === 'planet' && cell.planetOwner === player,
  )
  let best: Project | null = null
  for (const source of Object.values(s.cells)) {
    if (source.sourceOwner !== player || !isSource(source)) continue
    const plan = outputPlan(s, player, source)
    if (!plan) continue
    const points = [source.hex]
    if (plan.via) points.push(plan.via)
    if (planets.length > 0) {
      const from = plan.via ?? source.hex
      const preferred = planets.filter((cell) =>
        cell.consumers.some((c) => c.type === plan.resource),
      )
      const planet = nearestHex(
        s.cells,
        from,
        (preferred.length > 0 ? preferred : planets).map((cell) => cell.hex),
      )
      if (planet) points.push(planet)
    }
    if (points.length < 2) continue
    const path = chain(s.cells, points)
    if (!path || path.length < 2) continue
    const missing = missingEdges(s, path)
    if (
      !best ||
      missing.length < best.missing.length ||
      (missing.length === best.missing.length && path.length < best.path.length)
    ) {
      best = { path, missing }
    }
  }
  return best
}

function edgeInRange(ship: Axial, edge: MissingEdge): boolean {
  return hexDistance(ship, edge.a) <= 1 || hexDistance(ship, edge.b) <= 1
}

function pickTier(money: number, upkeep: number): RouteTier | null {
  if (money - 4 >= upkeep + 8) return 'purple'
  if (money - 2 >= upkeep + 4) return 'blue'
  return null
}

function legalSteps(s: GameState, player: PlayerId): Axial[] {
  const ship = s.ships[player]
  const steps: Axial[] = []
  for (const d of DIRECTIONS) {
    const hex = neighbor(ship, d.id)
    const cell = s.cells[hexKey(hex)]
    if (!walkable(cell) || occupiedByRival(s, player, hex)) continue
    steps.push(hex)
  }
  return steps
}

/** First step of the shortest walk to the nearest target. */
function stepAlongTo(s: GameState, player: PlayerId, targets: Axial[]): Axial | null {
  const ship = s.ships[player]
  const allowed = new Set(legalSteps(s, player).map(hexKey))
  const options: Axial[][] = []
  let bestLen = Infinity
  for (const target of targets) {
    const path = pathBetween(s.cells, ship, target)
    if (!path || path.length < 2) continue
    options.push(path)
    if (path.length < bestLen) bestLen = path.length
  }
  const chosen = options
    .filter((path) => path.length <= bestLen)
    .sort((a, b) => hexKey(a[a.length - 1]).localeCompare(hexKey(b[b.length - 1])))[0]
  if (!chosen || !allowed.has(hexKey(chosen[1]))) return null
  return chosen[1]
}

function wantedNeutrals(s: GameState, player: PlayerId): Axial[] {
  const hexes: Axial[] = []
  for (const cell of Object.values(s.cells)) {
    if (!cell.revealed) continue
    if (isSource(cell) && cell.sourceOwner == null) hexes.push(cell.hex)
    else if (cell.terrain === 'planet' && cell.planetOwner == null) hexes.push(cell.hex)
    else if (cell.field?.owner == null && cell.field && usefulFactory(s, player, cell.field.kind)) {
      hexes.push(cell.hex)
    }
  }
  return hexes
}

function claimInRange(s: GameState, player: PlayerId): AiAction | null {
  const ship = s.ships[player]
  let best: { hex: Axial; score: number } | null = null
  for (const cell of Object.values(s.cells)) {
    if (!cell.revealed || !hexEquals(ship, cell.hex)) continue
    let score = 0
    if (isSource(cell) && cell.sourceOwner == null) score = 8
    else if (cell.terrain === 'planet' && cell.planetOwner == null) score = 7
    else if (cell.field?.owner == null && cell.field && usefulFactory(s, player, cell.field.kind)) {
      score = 5
    }
    if (score === 0) continue
    if (!best || score > best.score) best = { hex: cell.hex, score }
  }
  return best ? { type: 'claimFacility', hex: best.hex } : null
}

function extractorAction(s: GameState, player: PlayerId): AiAction | null {
  if ((s.actionsLeft[player] ?? 0) <= 0) return null
  if (s.players[player].money - EXTRACTOR_COST < upkeepDue(s, player)) return null
  const ship = s.ships[player]
  let best: Axial | null = null
  let bestKey = ''
  for (const cell of Object.values(s.cells)) {
    if (cell.sourceOwner !== player || !isSource(cell)) continue
    if ((cell.extractors ?? 0) > 0) continue
    if (hexDistance(ship, cell.hex) > 1) continue
    const key = hexKey(cell.hex)
    if (!best || key < bestKey) {
      best = cell.hex
      bestKey = key
    }
  }
  return best ? { type: 'buildExtractor', hex: best } : null
}

function hasExtractor(s: GameState, player: PlayerId): boolean {
  return Object.values(s.cells).some(
    (cell) =>
      cell.sourceOwner === player && isSource(cell) && (cell.extractors ?? 0) > 0,
  )
}

function nearestBareSource(s: GameState, player: PlayerId): Axial | null {
  const ship = s.ships[player]
  let best: { hex: Axial; dist: number; key: string } | null = null
  for (const cell of Object.values(s.cells)) {
    if (cell.sourceOwner !== player || !isSource(cell)) continue
    if ((cell.extractors ?? 0) > 0) continue
    const dist = hexDistance(ship, cell.hex)
    const key = hexKey(cell.hex)
    if (!best || dist < best.dist || (dist === best.dist && key < best.key)) {
      best = { hex: cell.hex, dist, key }
    }
  }
  return best?.hex ?? null
}

function factoryValue(kind: FieldKind, s: GameState, player: PlayerId): number {
  if (kind === 'solar') return ownsTerrain(s, player, 'sun') ? 6 : 1
  if (kind === 'thermalCell') return ownsTerrain(s, player, 'sun') ? 5 : 1
  if (kind === 'nuclearPlant') return ownsTerrain(s, player, 'uranium') ? 6 : 2
  if (kind === 'transformer') return 4
  if (kind === 'turbine') return ownsTerrain(s, player, 'water') ? 4 : 1
  return 1
}

function worstFactory(s: GameState, player: PlayerId): Axial | null {
  let worst: { hex: Axial; value: number; key: string } | null = null
  for (const cell of Object.values(s.cells)) {
    if (cell.field?.owner !== player) continue
    const value = factoryValue(cell.field.kind, s, player)
    const key = hexKey(cell.hex)
    if (!worst || value < worst.value || (value === worst.value && key < worst.key)) {
      worst = { hex: cell.hex, value, key }
    }
  }
  return worst?.hex ?? null
}

function broke(s: GameState, player: PlayerId): boolean {
  return upkeepDue(s, player) > s.players[player].money
}

function decideOffer(s: GameState, offer: GameState['offers'][number]): AiAction {
  const cell = s.cells[hexKey(offer.hex)]
  if (!cell) return { type: 'declineOffer', id: offer.id }
  if (cell.field) {
    return usefulFactory(s, offer.player, cell.field.kind)
      ? { type: 'claimOffer', id: offer.id }
      : { type: 'declineOffer', id: offer.id }
  }
  if (cell.terrain === 'planet' || isSource(cell)) {
    return { type: 'claimOffer', id: offer.id }
  }
  return { type: 'declineOffer', id: offer.id }
}

function planetMissingConsumer(s: GameState, player: PlayerId): Axial | null {
  const meters = supplyableMeters(s, player)
  if (meters.length === 0) return null
  if (ownConsumerCount(s, player) >= 1 && s.players[player].money < 14) return null
  if (s.players[player].money - CONSUMER_COST < upkeepDue(s, player) + 4) return null
  const ship = s.ships[player]
  let best: { hex: Axial; dist: number } | null = null
  for (const cell of Object.values(s.cells)) {
    if (cell.terrain !== 'planet' || cell.planetOwner !== player) continue
    if (cell.consumers.length >= 2) continue
    const open = meters.some(
      (meter) => !cell.consumers.some((c) => c.type === meter) && cell[meter] < 4,
    )
    if (!open) continue
    const dist = hexDistance(ship, cell.hex)
    if (dist <= 1) continue
    if (!best || dist < best.dist) best = { hex: cell.hex, dist }
  }
  return best?.hex ?? null
}

function consumerAction(s: GameState, player: PlayerId): AiAction | null {
  const meters = supplyableMeters(s, player)
  if (meters.length === 0) return null
  if (ownConsumerCount(s, player) >= 1 && s.players[player].money < 14) return null
  if (s.players[player].money - CONSUMER_COST < upkeepDue(s, player) + 4) return null
  const ship = s.ships[player]
  let best: { hex: Axial; meter: MeterKind; score: number } | null = null
  for (const cell of Object.values(s.cells)) {
    if (cell.terrain !== 'planet' || cell.planetOwner !== player) continue
    if (hexDistance(ship, cell.hex) > 1 || cell.consumers.length >= 2) continue
    for (const meter of meters) {
      if (cell.consumers.some((c) => c.type === meter) || cell[meter] >= 4) continue
      const score = -cell[meter]
      if (!best || score > best.score) best = { hex: cell.hex, meter, score }
    }
  }
  return best ? { type: 'approveConsumer', hex: best.hex, meter: best.meter } : null
}

function feeAction(s: GameState, player: PlayerId): AiAction | null {
  const supply = new Set(supplyableMeters(s, player))
  for (const cell of Object.values(s.cells)) {
    if (cell.sourceOwner === player && (cell.sourceFee ?? 0) === 0) {
      return { type: 'setSourceFee', hex: cell.hex, fee: 2 }
    }
  }
  for (const cell of Object.values(s.cells)) {
    if (cell.field?.owner === player && (cell.field.fee ?? 0) === 0) {
      return { type: 'setFactoryFee', hex: cell.hex, fee: 1 }
    }
  }
  for (const [key, route] of Object.entries(s.routes)) {
    if (route.owner !== player || route.fee > 0) continue
    const [a, b] = parseEdgeKey(key)
    const dir = dirBetween(a, b)
    if (!dir) continue
    return { type: 'setRouteFee', hex: a, dir, fee: 1 }
  }
  for (const cell of Object.values(s.cells)) {
    if (cell.planetOwner !== player || cell.terrain !== 'planet') continue
    if ((cell.importFee ?? 0) > 0) continue
    const desperate = (['voltage', 'water', 'heat'] as MeterKind[]).some(
      (meter) => cell[meter] <= -4 && !supply.has(meter),
    )
    if (desperate) continue
    return { type: 'setImportFee', hex: cell.hex, fee: 2 }
  }
  return null
}

function upgradeOnPath(s: GameState, player: PlayerId, path: Axial[]): AiAction | null {
  if (s.players[player].money - 2 < upkeepDue(s, player)) return null
  const ship = s.ships[player]
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const route = s.routes[edgeKey(a, b)]
    if (!route || route.owner !== player || route.tier !== 'blue') continue
    if (hexDistance(ship, a) > 1 && hexDistance(ship, b) > 1) continue
    const dir = dirBetween(a, b)
    if (!dir) continue
    return { type: 'upgradeRoute', hex: a, dir, tier: 'purple' }
  }
  return null
}

function reloadTrafo(s: GameState, player: PlayerId): AiAction | null {
  if ((s.actionsLeft[player] ?? 0) <= 0) return null
  if (s.players[player].money - TRAFO_RELOAD_COST < upkeepDue(s, player) + 4) return null
  const ship = s.ships[player]
  for (const cell of Object.values(s.cells)) {
    const field = cell.field
    if (field?.owner !== player || field.kind !== 'transformer') continue
    if (field.charge.length > 1 || hexDistance(ship, cell.hex) > 1) continue
    return { type: 'recharge', hex: cell.hex }
  }
  return null
}

function chooseAct(s: GameState, player: PlayerId): AiAction {
  const claim = claimInRange(s, player)
  if (claim) return claim
  if (broke(s, player)) {
    const hex = worstFactory(s, player)
    if (hex) return { type: 'abandonFacility', hex }
  }

  const ap = s.actionsLeft[player] ?? 0
  if (ap > 0) {
    const extractor = extractorAction(s, player)
    if (extractor) return extractor
    if (!hasExtractor(s, player)) {
      const bare = nearestBareSource(s, player)
      if (bare) {
        const step = stepAlongTo(s, player, [bare])
        if (step) return { type: 'moveShip', hex: step }
      }
    }
    const project = supplyProject(s, player)
    const edge = project?.missing[0]
    const routeReady = !project || project.missing.length <= 2
    if (edge && edgeInRange(s.ships[player], edge)) {
      const tier = pickTier(s.players[player].money, upkeepDue(s, player))
      if (tier) return { type: 'buildRoute', hex: edge.a, dir: edge.dir, tier }
    }
    if (routeReady) {
      const consumer = consumerAction(s, player)
      if (consumer) return consumer
    }
    if (edge) {
      const step = stepAlongTo(s, player, [edge.a, edge.b])
      if (step) return { type: 'moveShip', hex: step }
    }
    if (routeReady) {
      const planet = planetMissingConsumer(s, player)
      if (planet) {
        const step = stepAlongTo(s, player, [planet])
        if (step) return { type: 'moveShip', hex: step }
      }
    }
    const prize = stepAlongTo(s, player, wantedNeutrals(s, player))
    if (prize) return { type: 'moveShip', hex: prize }
    if (project && project.missing.length === 0) {
      const upgrade = upgradeOnPath(s, player, project.path)
      if (upgrade) return upgrade
    }
    const reload = reloadTrafo(s, player)
    if (reload) return reload
  }

  const fee = feeAction(s, player)
  if (fee) return fee
  if (ap > 0) return { type: 'endActions' }
  return { type: 'nextPhase' }
}

function fakeChip(color: ChipColor, resource: ChipResource, hex: Axial): Chip {
  return { id: 'ai', color, state: 'flying', hex, resource }
}

function hasHeatChain(s: GameState, player: PlayerId): boolean {
  return Object.values(s.cells).some(
    (cell) =>
      cell.field?.owner === player &&
      (cell.field.kind === 'thermalCell' || cell.field.kind === 'nuclearPlant'),
  )
}

function betterPlan(best: Plan | null, next: Plan): Plan {
  if (!best || next.score > best.score) return next
  return best
}

function bestPlan(
  s: GameState,
  player: PlayerId,
  origin: Axial,
  resource: ChipResource,
  color: ChipColor,
  seen: Record<string, number>,
  upfront: number,
): Plan | null {
  const money = s.players[player].money
  if (money < upfront) return null
  let best: Plan | null = null
  const spentBest = new Map<string, number>()
  const queue: {
    hex: Axial
    resource: ChipResource
    spent: number
    steps: Step[]
    seen: Record<string, number>
    triggered: Record<string, true>
    bonus: number
  }[] = [
    {
      hex: origin,
      resource,
      spent: 0,
      steps: [],
      seen: { ...seen },
      triggered: {},
      bonus: 0,
    },
  ]
  let guard = 0
  while (queue.length > 0 && guard < 900) {
    guard += 1
    const frame = queue.shift()!
    const key = hexKey(frame.hex)
    const sig = `${key}|${frame.resource}|${Object.keys(frame.triggered).sort().join('.')}`
    const prevSpent = spentBest.get(sig)
    if (prevSpent != null && prevSpent <= frame.spent) continue
    spentBest.set(sig, frame.spent)
    const cell = s.cells[key]
    if (!cell?.revealed) continue

    const meter = asMeter(frame.resource)
    if (
      meter &&
      cell.terrain === 'planet' &&
      cell.consumers.some((c) => c.type === meter)
    ) {
      const energy = CHIP_ENERGY[color]
      const before = cell[meter]
      const gross = supplyPayout(before, energy)
      const extra = gross > 0 ? Math.min(frame.bonus, gross) : 0
      const owner = cell.planetOwner
      const own = owner == null || owner === player
      const tariff = owner && owner !== player ? feeAmount(cell.importFee) : 0
      const overflows = before + energy >= CRITICAL_LIMIT
      if (!overflows && money >= upfront + frame.spent + tariff) {
        const profit = gross + extra - tariff - frame.spent - upfront
        const demandFill = Math.min(energy, Math.max(0, -before))
        // Serve own consumers even when the meter is 0 (no payout yet).
        const serve =
          own && before <= 0
            ? 20 + demandFill * 5
            : demandFill > 0
              ? 8 + demandFill * 3
              : 0
        const score = profit * 100 + serve - frame.steps.length
        if (profit > 0 || serve > 0) {
          best = betterPlan(best, {
            score,
            profit,
            steps: [...frame.steps, { kind: 'deliver', payTariff: true }],
          })
        }
      }
    }

    if (frame.steps.length >= 10) continue
    const field = cell.field
    if (field && !frame.triggered[key]) {
      const effect = factoryEffect(field, fakeChip(color, frame.resource, frame.hex))
      const fee = field.owner != null && field.owner !== player ? feeAmount(field.fee) : 0
      if (effect && money >= upfront + frame.spent + fee) {
        if (effect.type === 'convert') {
          queue.push({
            ...frame,
            resource: effect.resource,
            spent: frame.spent + fee,
            steps: [...frame.steps, { kind: 'trigger' }],
            triggered: { ...frame.triggered, [key]: true },
          })
        } else if (effect.type === 'turbine-split' || effect.type === 'trafo-split') {
          queue.push({
            ...frame,
            resource: 'voltage',
            spent: frame.spent + fee,
            bonus: frame.bonus + CHIP_ENERGY[field.charge[0] ?? 'blue'],
            steps: [...frame.steps, { kind: 'trigger' }],
            triggered: { ...frame.triggered, [key]: true },
          })
        } else if (
          effect.type === 'store-water' &&
          field.owner === player &&
          hasHeatChain(s, player)
        ) {
          const profit = 2 - frame.spent - upfront
          if (profit >= 0) {
            best = betterPlan(best, {
              score: profit * 100 + 5,
              profit,
              steps: [...frame.steps, { kind: 'trigger' }],
            })
          }
        }
      }
    }

    for (const d of DIRECTIONS) {
      const dest = neighbor(frame.hex, d.id)
      const route = s.routes[edgeKey(frame.hex, dest)]
      if (!route || !tierAllows(route.tier, color)) continue
      const fee = route.owner === player ? 0 : feeAmount(route.fee)
      if (money < upfront + frame.spent + fee) continue
      const destKey = hexKey(dest)
      const visits = (frame.seen[destKey] ?? 0) + 1
      if (visits >= 3) continue
      if (!walkable(s.cells[destKey])) continue
      queue.push({
        ...frame,
        hex: dest,
        spent: frame.spent + fee,
        steps: [...frame.steps, { kind: 'move', dir: d.id }],
        seen: { ...frame.seen, [destKey]: visits },
      })
    }
  }
  return best
}

function stepOf(plan: Plan): AiAction {
  const step = plan.steps[0]
  if (!step || step.kind === 'trigger') return { type: 'triggerFactory' }
  if (step.kind === 'move') return { type: 'followRoute', dir: step.dir }
  return { type: 'deliver', payTariff: step.payTariff }
}

function sourceFee(cell: CellState, player: PlayerId): number {
  return cell.sourceOwner && cell.sourceOwner !== player ? feeAmount(cell.sourceFee) : 0
}

function chooseSim(s: GameState, player: PlayerId): AiAction {
  const flying = s.chips.find((chip) => chip.state === 'flying')
  if (s.pendingHit && flying && s.pendingHit.chipId === flying.id) {
    if (s.pendingHit.mode === 'color') return { type: 'pickColor', color: 'red' }
    const cell = s.cells[hexKey(s.pendingHit.hex)]
    const effect = cell?.field ? factoryEffect(cell.field, flying) : null
    const fee =
      cell?.field?.owner != null && cell.field.owner !== player
        ? feeAmount(cell.field.fee)
        : 0
    if (!effect || fee > s.players[player].money) return { type: 'declineHit' }
    return { type: 'confirmHit' }
  }

  if (flying) {
    const resource = flying.resource ?? 'water'
    const plan = bestPlan(
      s,
      player,
      flying.hex,
      resource,
      flying.color,
      flying.seen ?? { [hexKey(flying.hex)]: 1 },
      0,
    )
    if (!plan) return { type: 'abort' }
    return stepOf(plan)
  }

  let bestTake: { score: number; hex: Axial; index: number } | null = null
  for (const cell of Object.values(s.cells)) {
    if (!cell.revealed || !isSource(cell) || cell.sourceOwner == null) continue
    if (cell.sourceStock.length === 0) continue
    const resource = SOURCE_RESOURCE[cell.terrain]
    if (!resource) continue
    const upfront = sourceFee(cell, player)
    // Prefer own stock, then foreign if the trip still scores.
    const ownBias = cell.sourceOwner === player ? 3 : 0
    for (let index = 0; index < cell.sourceStock.length; index++) {
      const color = cell.sourceStock[index]
      const plan = bestPlan(
        s,
        player,
        cell.hex,
        resource,
        color,
        { [hexKey(cell.hex)]: 1 },
        upfront,
      )
      if (!plan) continue
      const score = plan.score + ownBias
      if (!bestTake || score > bestTake.score) {
        bestTake = { score, hex: cell.hex, index }
      }
    }
  }

  let bestStore: { score: number; hex: Axial } | null = null
  for (const cell of Object.values(s.cells)) {
    const field = cell.field
    if (field?.kind !== 'pumped' || field.charge.length === 0) continue
    if ((field.storedBy ?? field.owner) !== player) continue
    const plan = bestPlan(
      s,
      player,
      cell.hex,
      field.chargeResource ?? 'water',
      field.charge[0],
      { [hexKey(cell.hex)]: 1 },
      0,
    )
    if (!plan) continue
    if (!bestStore || plan.score > bestStore.score) {
      bestStore = { score: plan.score, hex: cell.hex }
    }
  }

  if (bestTake && (!bestStore || bestTake.score >= bestStore.score)) {
    return { type: 'takeSource', hex: bestTake.hex, index: bestTake.index }
  }
  if (bestStore) return { type: 'releaseStorage', hex: bestStore.hex }

  // Rebellion pressure: only pull a chip if it can still reach a consumer.
  for (const cell of Object.values(s.cells)) {
    if (cell.sourceOwner !== player || cell.sourceStock.length < 4) continue
    const resource = SOURCE_RESOURCE[cell.terrain]
    if (!resource) continue
    for (let index = 0; index < cell.sourceStock.length; index++) {
      const plan = bestPlan(
        s,
        player,
        cell.hex,
        resource,
        cell.sourceStock[index],
        { [hexKey(cell.hex)]: 1 },
        0,
      )
      if (plan) return { type: 'takeSource', hex: cell.hex, index }
    }
  }
  return { type: 'pass' }
}

function aiOn(s: GameState, player: PlayerId): boolean {
  return Boolean(s.ai?.[player])
}

/** Next computer decision, or null when a person is supposed to play. */
export function chooseAiAction(s: GameState): AiAction | null {
  if (s.gameOver || s.lost) return null
  if (!s.playerIds.some((id) => aiOn(s, id))) return null

  const ownOffers = s.offers.filter(
    (item) => item.player === s.activePlayer && aiOn(s, item.player),
  )
  const offer =
    ownOffers.find((item) => {
      const cell = s.cells[hexKey(item.hex)]
      return cell != null && !cell.field
    }) ?? ownOffers[0]
  if (offer) return decideOffer(s, offer)

  if (s.upkeepPlayer) {
    if (!aiOn(s, s.upkeepPlayer)) return null
    const hex = worstFactory(s, s.upkeepPlayer)
    return hex ? { type: 'closeForUpkeep', hex } : null
  }

  if (s.phase === 'order') {
    const personStillDeciding = s.offers.some((item) => !aiOn(s, item.player))
    if (personStillDeciding) return null
    return { type: 'nextPhase' }
  }

  if (s.phase === 'act') {
    if (!aiOn(s, s.activePlayer)) return null
    return chooseAct(s, s.activePlayer)
  }

  if (s.phase === 'simulate') {
    if (s.simDone) return { type: 'nextPhase' }
    const flying = s.chips.find((chip) => chip.state === 'flying')
    const actor = flying?.pilot ?? s.activePlayer
    if (!aiOn(s, actor)) return null
    return chooseSim(s, actor)
  }

  return null
}
