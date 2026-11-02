import type { CellState, Coord, GameState, PlayerId } from '../types'
import { keyOf } from '../types'

const DIRS: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export function neighbors(c: Coord): Coord[] {
  return DIRS.map((d) => ({ x: c.x + d.x, y: c.y + d.y }))
}

export function exists(state: GameState, x: number, y: number): boolean {
  return keyOf(x, y) in state.cells
}

export interface TraverseOptions {
  /**
   * True when entering this cell as the final landing destination
   * (Karte wird dort abgelegt), not merely passing through.
   */
  asDestination?: boolean
}

function hasFeeMarker(cell: CellState): boolean {
  return (
    cell.kind === 'empty' &&
    Boolean(cell.owner) &&
    cell.stack.length > 0
  )
}

/**
 * Cost for entering a cell.
 * - Leeres Gebührenfeld: darüber = volle Gebühr an Inhaber; darauf ablegen = 1¤ Bank
 * - Planeten haben keine Gebührenmarker; Betreten kostet immer 1¤ an die Bank
 */
export function traverseCost(
  cell: CellState,
  mover: PlayerId,
  opts: TraverseOptions = {},
): { cost: number; payTo: PlayerId | 'bank' } | null {
  const land = Boolean(opts.asDestination)

  if (cell.kind === 'asteroid') return { cost: 3, payTo: 'bank' }
  if (cell.kind === 'sun') return { cost: 1, payTo: 'bank' }
  if (cell.kind === 'planet') return { cost: 1, payTo: 'bank' }

  if (hasFeeMarker(cell)) {
    const owner = cell.owner!
    if (owner === mover) return { cost: 0, payTo: 'bank' }

    const payTo: PlayerId | 'bank' =
      owner === 'neutral' ? 'bank' : owner

    // Darüber: Gebühr; darauf ablegen: nur 1 an die Bank
    if (land) return { cost: 1, payTo: 'bank' }
    return { cost: cell.toll, payTo }
  }

  if (cell.kind === 'empty') return { cost: 1, payTo: 'bank' }

  return { cost: 1, payTo: 'bank' }
}

export interface PathResult {
  path: Coord[]
  totalCost: number
  payments: { to: PlayerId | 'bank'; amount: number }[]
}

function mergePayments(
  payments: { to: PlayerId | 'bank'; amount: number }[],
): { to: PlayerId | 'bank'; amount: number }[] {
  const agg = new Map<string, number>()
  for (const p of payments) {
    agg.set(p.to, (agg.get(p.to) ?? 0) + p.amount)
  }
  return [...agg.entries()].map(([to, amount]) => ({
    to: to as PlayerId | 'bank',
    amount,
  }))
}

/**
 * Cheapest orthogonal path from start to goal.
 * Start is free; every entered cell costs.
 * When `landOnGoal` is true, the goal uses landing fees; otherwise pass fees.
 */
export function findCheapestPath(
  state: GameState,
  start: Coord,
  goal: Coord,
  mover: PlayerId,
  opts: { landOnGoal?: boolean } = {},
): PathResult | null {
  const landOnGoal = Boolean(opts.landOnGoal)

  if (start.x === goal.x && start.y === goal.y) {
    return { path: [start], totalCost: 0, payments: [] }
  }
  if (!exists(state, goal.x, goal.y)) return null

  type Node = { x: number; y: number; cost: number }
  const startKey = keyOf(start.x, start.y)
  const goalKey = keyOf(goal.x, goal.y)
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const payEdge = new Map<string, { to: PlayerId | 'bank'; amount: number }>()

  const pq: Node[] = [{ x: start.x, y: start.y, cost: 0 }]
  dist.set(startKey, 0)

  while (pq.length) {
    pq.sort((a, b) => a.cost - b.cost)
    const cur = pq.shift()!
    const ck = keyOf(cur.x, cur.y)
    if (cur.cost !== dist.get(ck)) continue
    if (ck === goalKey) break

    for (const n of neighbors(cur)) {
      if (!exists(state, n.x, n.y)) continue
      const nk = keyOf(n.x, n.y)
      const cell = state.cells[nk]
      const asDestination = landOnGoal && nk === goalKey
      const tc = traverseCost(cell, mover, { asDestination })
      if (!tc) continue
      const stepCost = tc.cost
      const payment =
        tc.cost > 0 ? { to: tc.payTo, amount: tc.cost } : null

      const nextCost = cur.cost + stepCost
      if (nextCost < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nextCost)
        prev.set(nk, ck)
        if (payment) payEdge.set(nk, payment)
        else payEdge.delete(nk)
        pq.push({ x: n.x, y: n.y, cost: nextCost })
      }
    }
  }

  if (!dist.has(goalKey)) return null

  const path: Coord[] = []
  let k: string | undefined = goalKey
  while (k) {
    const [xs, ys] = k.split(',')
    path.push({ x: Number(xs), y: Number(ys) })
    k = prev.get(k)
  }
  path.reverse()

  const payments: { to: PlayerId | 'bank'; amount: number }[] = []
  for (let i = 1; i < path.length; i++) {
    const pk = keyOf(path[i].x, path[i].y)
    const p = payEdge.get(pk)
    if (p) payments.push(p)
  }

  return {
    path,
    totalCost: dist.get(goalKey)!,
    payments: mergePayments(payments),
  }
}

/** Cheapest path that must visit waypoints in order before the goal. */
export function findPathVia(
  state: GameState,
  start: Coord,
  waypoints: Coord[],
  goal: Coord,
  mover: PlayerId,
): PathResult | null {
  const points: Coord[] = [start]
  for (const wp of waypoints) {
    const last = points[points.length - 1]
    if (last.x === wp.x && last.y === wp.y) continue
    points.push(wp)
  }
  const last = points[points.length - 1]
  if (last.x !== goal.x || last.y !== goal.y) points.push(goal)

  if (points.length === 1) {
    return { path: [start], totalCost: 0, payments: [] }
  }

  const path: Coord[] = []
  let totalCost = 0
  const payments: { to: PlayerId | 'bank'; amount: number }[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const isFinalSegment = i === points.length - 2
    const seg = findCheapestPath(
      state,
      points[i],
      points[i + 1],
      mover,
      { landOnGoal: isFinalSegment },
    )
    if (!seg) return null
    if (i === 0) path.push(...seg.path)
    else path.push(...seg.path.slice(1))
    totalCost += seg.totalCost
    payments.push(...seg.payments)
  }

  return { path, totalCost, payments: mergePayments(payments) }
}
