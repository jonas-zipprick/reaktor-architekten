import { difficultyFee, type Difficulty } from './difficulty'
import { hexEquals, hexKey } from '../hex/math'
import type { Axial, GameMode } from '../types'

export type PatrolKind = 'loop' | 'pendulum'

/** Static route from a scenario definition. */
export type FreibeuterDef = {
  id: string
  /** Base fee before difficulty. */
  fee: number
  patrol: PatrolKind
  /** Ordered waypoints; neighbors along the path. */
  route: Axial[]
  /** Index into route for the starting hex. */
  startIndex: number
  /** Initial step direction along the route (+1 forward, −1 backward). */
  startDir: 1 | -1
}

/** Live freibeuter marker during a solo/coop game. */
export type Freibeuter = {
  id: string
  fee: number
  patrol: PatrolKind
  route: Axial[]
  hex: Axial
  routeIndex: number
  dir: 1 | -1
}

export function spawnFreibeuter(
  defs: FreibeuterDef[],
  mode: GameMode,
  difficulty: Difficulty,
): Freibeuter[] {
  if (mode === 'versus' || defs.length === 0) return []
  const active = mode === 'solo' ? defs.slice(0, 1) : defs
  return active.map((def) => {
    const idx = Math.max(0, Math.min(def.startIndex, def.route.length - 1))
    return {
      id: def.id,
      fee: difficultyFee(def.fee, difficulty),
      patrol: def.patrol,
      route: def.route.map((h) => ({ ...h })),
      hex: { ...def.route[idx]! },
      routeIndex: idx,
      dir: def.startDir,
    }
  })
}

/** Advance one hex along the patrol (called from round 2 onward). */
export function stepFreibeuter(f: Freibeuter): Freibeuter {
  const n = f.route.length
  if (n <= 1) return f
  let dir = f.dir
  let next = f.routeIndex + dir
  if (f.patrol === 'loop') {
    next = ((next % n) + n) % n
  } else {
    if (next < 0 || next >= n) {
      dir = (dir === 1 ? -1 : 1) as 1 | -1
      next = f.routeIndex + dir
      next = Math.max(0, Math.min(n - 1, next))
    }
  }
  return {
    ...f,
    dir,
    routeIndex: next,
    hex: { ...f.route[next]! },
  }
}

export function moveAllFreibeuter(list: Freibeuter[]): Freibeuter[] {
  return list.map(stepFreibeuter)
}

/** Sum of freibeuter fees on a hex. */
export function pirateFeeAt(list: Freibeuter[], hex: Axial): number {
  let sum = 0
  for (const f of list) {
    if (hexEquals(f.hex, hex)) sum += f.fee
  }
  return sum
}

export function freibeuterOnHex(list: Freibeuter[], hex: Axial): Freibeuter[] {
  return list.filter((f) => hexEquals(f.hex, hex))
}

export function freibeuterLabel(f: Freibeuter): string {
  return `${f.id} (${f.fee} Geld)`
}

export function describeFreibeuterPos(f: Freibeuter): string {
  return `${f.id} @ (${f.hex.q},${f.hex.r}) · ${f.fee} Geld`
}

export function freibeuterKey(f: Freibeuter): string {
  return `${f.id}:${hexKey(f.hex)}`
}
