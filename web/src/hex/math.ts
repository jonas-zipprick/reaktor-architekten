import { DIRECTIONS, type Axial, type DirIndex } from '../types'

export function hexKey(h: Axial): string {
  return `${h.q},${h.r}`
}

export function parseKey(key: string): Axial {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

export function hexEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}

export function neighbor(h: Axial, dir: DirIndex): Axial {
  const d = DIRECTIONS[dir - 1]
  return { q: h.q + d.dq, r: h.r + d.dr }
}

/** Undirected edge. The same key is used from either hex. */
export function edgeKey(a: Axial, b: Axial): string {
  const ka = hexKey(a)
  const kb = hexKey(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

export function parseEdgeKey(key: string): [Axial, Axial] {
  const [a, b] = key.split('|')
  return [parseKey(a), parseKey(b)]
}

/** Direction from `from` to an adjacent hex, or null when they do not share an edge. */
export function dirBetween(from: Axial, to: Axial): DirIndex | null {
  for (const d of DIRECTIONS) {
    const n = neighbor(from, d.id)
    if (n.q === to.q && n.r === to.r) return d.id
  }
  return null
}

/** Cube distance */
export function hexDistance(a: Axial, b: Axial): number {
  const aq = a.q
  const ar = a.r
  const as = -aq - ar
  const bq = b.q
  const br = b.r
  const bs = -bq - br
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs))
}

/** All hexes in a hexagon of given radius (center 0,0). */
export function hexDisk(radius: number): Axial[] {
  const out: Axial[] = []
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius)
    const r2 = Math.min(radius, -q + radius)
    for (let r = r1; r <= r2; r++) {
      out.push({ q, r })
    }
  }
  return out
}

/** Opposite direction (180°). Soft wall bounce default. */
export function oppositeDir(dir: DirIndex): DirIndex {
  return ((((dir - 1 + 3) % 6) + 1) as DirIndex)
}

export function rotateDir(dir: DirIndex, steps: number): DirIndex {
  return ((((dir - 1 + steps) % 6 + 6) % 6) + 1) as DirIndex
}

/**
 * Pointy-top axial → pixel.
 * size = distance from center to vertex.
 */
export function axialToPixel(h: Axial, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (h.q + h.r / 2)
  const y = size * (3 / 2) * h.r
  return { x, y }
}

/** Flat list of 6 corner points for a pointy-top hex centered at (cx,cy). */
export function hexCorners(
  cx: number,
  cy: number,
  size: number,
): { x: number; y: number }[] {
  const corners = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    })
  }
  return corners
}

export function cornersToPath(corners: { x: number; y: number }[]): string {
  return (
    corners.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ') + ' Z'
  )
}

/** Pixel of the midpoint of edge `dir` (1–6). */
export function edgeMidpoint(
  cx: number,
  cy: number,
  size: number,
  dir: DirIndex,
): { x: number; y: number } {
  const corners = hexCorners(cx, cy, size)
  // Pointy-top corners at 60°·i − 30°. Flat edges face the six neighbor dirs:
  // dir1 NW → corners 4–5, dir2 NE → 5–0, dir3 E → 0–1, …
  const i = (dir + 3) % 6
  const a = corners[i]
  const b = corners[(i + 1) % 6]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
