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

/** Cost paid for traversing an intermediate cell (not start/goal). */
export function traverseCost(
  cell: CellState,
  mover: PlayerId,
): { cost: number; payTo: PlayerId | 'bank' } | null {
  // Asteroids can be traversed
  if (cell.kind === 'asteroid') return { cost: 3, payTo: 'bank' }
  if (cell.kind === 'sun' || cell.kind === 'storage' || cell.kind === 'planet') {
    return { cost: 0, payTo: 'bank' }
  }

  const top = cell.stack[cell.stack.length - 1]
  if (top?.suit === 'diamonds' && top.faceUp) {
    return { cost: 1, payTo: 'bank' }
  }
  if (top?.suit === 'spades' && top.faceUp) {
    const owner = cell.owner
    if (owner === mover) return { cost: 0, payTo: 'bank' }
    if (owner === 'neutral' || owner == null) {
      return { cost: cell.toll, payTo: 'bank' }
    }
    return { cost: cell.toll, payTo: owner }
  }

  if (cell.kind === 'base') return { cost: 1, payTo: 'bank' }
  if (cell.kind === 'empty') return { cost: 1, payTo: 'bank' }

  return { cost: 1, payTo: 'bank' }
}

export interface PathResult {
  path: Coord[]
  totalCost: number
  payments: { to: PlayerId | 'bank'; amount: number }[]
}

/**
 * Cheapest orthogonal path from start to goal (exclusive of start cost).
 * Start and goal themselves are free; only intermediate cells cost.
 */
export function findCheapestPath(
  state: GameState,
  start: Coord,
  goal: Coord,
  mover: PlayerId,
): PathResult | null {
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
      let stepCost = 0
      let payment: { to: PlayerId | 'bank'; amount: number } | null = null

      if (nk !== goalKey) {
        const cell = state.cells[nk]
        const tc = traverseCost(cell, mover)
        if (!tc) continue
        stepCost = tc.cost
        if (tc.cost > 0) payment = { to: tc.payTo, amount: tc.cost }
      }

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
  for (let i = 1; i < path.length - 1; i++) {
    const pk = keyOf(path[i].x, path[i].y)
    const p = payEdge.get(pk)
    if (p) payments.push(p)
  }

  // Aggregate payments
  const agg = new Map<string, number>()
  for (const p of payments) {
    agg.set(p.to, (agg.get(p.to) ?? 0) + p.amount)
  }
  const merged = [...agg.entries()].map(([to, amount]) => ({
    to: to as PlayerId | 'bank',
    amount,
  }))

  return { path, totalCost: dist.get(goalKey)!, payments: merged }
}
