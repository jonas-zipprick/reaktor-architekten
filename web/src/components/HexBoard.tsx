import { useMemo, useState, type MouseEvent } from 'react'
import { CRITICAL_LIMIT } from '../data/boardLayout'
import { FIELD_DEFS } from '../data/fields'
import {
  axialToPixel,
  cornersToPath,
  edgeKey,
  edgeMidpoint,
  hexCorners,
  hexDistance,
  hexEquals,
  hexKey,
  neighbor,
  parseEdgeKey,
} from '../hex/math'
import { planetHue } from '../data/planetNames'
import { tierAllows } from '../state/simRules'
import { useGame } from '../state/gameStore'
import { ActionBar, RouteChoices, useBoardFocus } from './BoardGhosts'
import { DIRECTIONS, type Axial, type CellState, type Chip, type ChipColor, type DirIndex, type PlayerId, type Route } from '../types'
import './HexBoard.css'

const SIZE = 42

const CHIP_FILL: Record<ChipColor, string> = {
  blue: '#3a7ca5',
  purple: '#7b5ea7',
  red: '#c45c48',
}

const CHIP_GRADIENT: Record<ChipColor, string> = {
  blue: 'url(#chipBlue)',
  purple: 'url(#chipPurple)',
  red: 'url(#chipRed)',
}

/** Deterministic pseudo-random in [0,1) from hex coords + salt (for fog stars). */
function hexNoise(hex: Axial, salt: number): number {
  const n = Math.sin(hex.q * 127.1 + hex.r * 311.7 + salt * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function Asteroid({ hex, cx, cy }: { hex: Axial; cx: number; cy: number }) {
  const rot = hexNoise(hex, 99) * 360
  const s = SIZE * 0.36
  // Irregular rock silhouette (unit coords), scaled by s.
  const rock =
    'M-0.9,-0.2 L-0.55,-0.75 L0.05,-0.95 L0.6,-0.7 L0.95,-0.15 L0.8,0.45 L0.35,0.9 L-0.3,0.85 L-0.8,0.5 Z'
  return (
    <g
      className="asteroid"
      transform={`translate(${cx} ${cy + SIZE * 0.02}) rotate(${rot}) scale(${s})`}
    >
      <path d={rock} className="asteroid-body" />
      <path
        d="M-0.55,-0.75 L0.05,-0.95 L0.6,-0.7 L0.3,-0.45 L-0.3,-0.5 Z"
        className="asteroid-light"
      />
      <circle cx={0.25} cy={0.15} r={0.22} className="asteroid-crater" />
      <circle cx={-0.4} cy={0.05} r={0.14} className="asteroid-crater" />
      <circle cx={0.05} cy={0.55} r={0.1} className="asteroid-crater" />
      <circle cx={-0.15} cy={-0.5} r={0.08} className="asteroid-crater" />
    </g>
  )
}

function PlanetDisc({
  name,
  cx,
  cy,
  owner,
}: {
  name?: string
  cx: number
  cy: number
  owner?: PlayerId
}) {
  const hue = planetHue(name)
  const id = `planet-${name ?? 'x'}`.replace(/[^a-zA-Z0-9-]/g, '')
  const r = SIZE * 0.34
  return (
    <g className="planet-disc">
      <defs>
        <radialGradient id={id} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor={`hsl(${hue} 55% 72%)`} />
          <stop offset="45%" stopColor={`hsl(${hue} 45% 42%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 50% 14%)`} />
        </radialGradient>
      </defs>
      <circle
        cx={cx}
        cy={cy}
        r={r + 5}
        className="planet-halo"
        style={{ fill: `hsl(${hue} 70% 60%)` }}
      />
      <ellipse
        cx={cx}
        cy={cy}
        rx={r * 1.55}
        ry={r * 0.42}
        className="planet-ring"
        transform={`rotate(-18 ${cx} ${cy})`}
        style={{ stroke: `hsl(${hue} 60% 75%)` }}
      />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
      <path
        d={`M${cx - r * 0.75},${cy - r * 0.1} Q${cx - r * 0.2},${cy - r * 0.45} ${cx + r * 0.55},${cy - r * 0.2}`}
        className="planet-band"
      />
      <path
        d={`M${cx - r * 0.5},${cy + r * 0.45} Q${cx + r * 0.1},${cy + r * 0.2} ${cx + r * 0.8},${cy + r * 0.35}`}
        className="planet-band"
      />
      {owner && (
        <OwnerPip
          cx={cx + r * 0.95}
          cy={cy - r * 0.95}
          owner={owner}
        />
      )}
    </g>
  )
}

/** Square so player markers stay distinct from round resource chips. */
function FeeMark({
  cx,
  cy,
  fee,
  label,
}: {
  cx: number
  cy: number
  fee: number
  label: string
}) {
  return (
    <g className="board-fee">
      <title>
        {label} {fee}
      </title>
      <circle cx={cx} cy={cy} r={8} className="board-fee-badge" />
      <text x={cx} y={cy + 3} className="field-fee" textAnchor="middle">
        {fee}
      </text>
    </g>
  )
}

function OwnerPip({
  cx,
  cy,
  owner,
}: {
  cx: number
  cy: number
  owner: PlayerId
}) {
  const s = 8
  return (
    <rect
      x={cx - s / 2}
      y={cy - s / 2}
      width={s}
      height={s}
      className={`owner-pip owner-pip-${owner}`}
    />
  )
}

function SourceIcon({
  kind,
  cx,
  cy,
}: {
  kind: 'uranium' | 'sun' | 'water'
  cx: number
  cy: number
}) {
  const r = SIZE * 0.26
  if (kind === 'sun') {
    return (
      <g className="source-icon source-sun">
        <circle cx={cx} cy={cy} r={r + 6} className="source-glow" />
        <g
          className="sun-rays"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * (r + 1)}
                y1={cy + Math.sin(a) * (r + 1)}
                x2={cx + Math.cos(a) * (r + 5)}
                y2={cy + Math.sin(a) * (r + 5)}
              />
            )
          })}
        </g>
        <circle cx={cx} cy={cy} r={r} fill="url(#sunCore)" />
      </g>
    )
  }
  if (kind === 'water') {
    return (
      <g className="source-icon source-water">
        <circle cx={cx} cy={cy} r={r + 6} className="source-glow" />
        <circle cx={cx} cy={cy} r={r} fill="url(#waterCore)" />
        <path
          d={`M${cx - r * 0.7},${cy - 2} q${r * 0.35},-${r * 0.4} ${r * 0.7},0 t${r * 0.7},0`}
          className="water-wave"
        />
        <path
          d={`M${cx - r * 0.7},${cy + 5} q${r * 0.35},-${r * 0.4} ${r * 0.7},0 t${r * 0.7},0`}
          className="water-wave"
        />
      </g>
    )
  }
  return (
    <g className="source-icon source-uranium">
      <circle cx={cx} cy={cy} r={r + 6} className="source-glow" />
      <circle cx={cx} cy={cy} r={r} fill="url(#uraniumCore)" />
      <g
        className="uranium-blades"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        {[0, 120, 240].map((deg) => (
          <path
            key={deg}
            d={`M${cx},${cy} L${cx + r * 0.9 * Math.cos(((deg - 30) * Math.PI) / 180)},${cy + r * 0.9 * Math.sin(((deg - 30) * Math.PI) / 180)} A${r * 0.9},${r * 0.9} 0 0 1 ${cx + r * 0.9 * Math.cos(((deg + 30) * Math.PI) / 180)},${cy + r * 0.9 * Math.sin(((deg + 30) * Math.PI) / 180)} Z`}
            className="uranium-blade"
          />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={r * 0.28} className="uranium-core" />
    </g>
  )
}

const TERRAIN_CLASS: Record<string, string> = {
  empty: 'terrain-empty',
  mountain: 'terrain-mountain',
  uranium: 'terrain-uranium',
  sun: 'terrain-sun',
  water: 'terrain-water',
  planet: 'terrain-planet',
}

/** Bound charges sit in the upper part of a hex. */
function ChipDots({
  colors,
  cx,
  cy,
  bound,
  onPick,
}: {
  colors: ChipColor[]
  cx: number
  cy: number
  bound: boolean
  onPick?: (index: number) => void
}) {
  const n = colors.length
  if (n === 0) return null
  const baseY = bound ? cy - SIZE * 0.48 : cy + SIZE * 0.5
  const spread = Math.min(SIZE * 0.55, 6 + n * 5)
  return (
    <g className={bound ? 'chips-bound' : 'chips-free'}>
      {colors.map((c, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1)
        const x = cx - spread / 2 + t * spread
        return (
          <circle
            key={`${c}-${i}`}
            cx={x}
            cy={baseY}
            r={bound ? 4 : 5}
            fill={CHIP_GRADIENT[c]}
            stroke={bound ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.75)'}
            strokeWidth={bound ? 0.8 : 1.1}
            className="chip-dot"
            onClick={
              onPick
                ? (event) => {
                    event.stopPropagation()
                    onPick(i)
                  }
                : undefined
            }
          />
        )
      })}
    </g>
  )
}

function SourceAimRing({
  cx,
  cy,
  current,
  onPick,
}: {
  cx: number
  cy: number
  current?: DirIndex
  onPick: (dir: DirIndex) => void
}) {
  return (
    <g className="source-aim-ring">
      {DIRECTIONS.map((d) => {
        const dir = d.id
        const mid = edgeMidpoint(cx, cy, SIZE * 1.02, dir)
        const dx = mid.x - cx
        const dy = mid.y - cy
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const tipX = cx + ux * SIZE * 0.98
        const tipY = cy + uy * SIZE * 0.98
        const baseX = cx + ux * SIZE * 0.56
        const baseY = cy + uy * SIZE * 0.56
        const nx = -uy
        const ny = ux
        const head = 9
        const chosen = current === dir
        return (
          <g
            key={dir}
            className={`source-aim-arrow ${chosen ? 'is-current' : ''}`}
            role="button"
            aria-label={`Richtung ${d.label}`}
            onClick={(e) => {
              e.stopPropagation()
              if (!chosen) onPick(dir)
            }}
          >
            <circle cx={tipX} cy={tipY} r={13} className="source-aim-hit" />
            <line
              x1={baseX}
              y1={baseY}
              x2={tipX - ux * 7}
              y2={tipY - uy * 7}
              className="source-aim-shaft"
            />
            <polygon
              points={`${tipX},${tipY} ${tipX - ux * head + nx * 5.5},${tipY - uy * head + ny * 5.5} ${tipX - ux * head - nx * 5.5},${tipY - uy * head - ny * 5.5}`}
              className="source-aim-head"
            />
          </g>
        )
      })}
    </g>
  )
}

function SourceArrow({
  cx,
  cy,
  dir,
}: {
  cx: number
  cy: number
  dir: DirIndex
}) {
  const mid = edgeMidpoint(cx, cy, SIZE * 0.82, dir)
  const dx = mid.x - cx
  const dy = mid.y - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const tipX = cx + ux * SIZE * 0.78
  const tipY = cy + uy * SIZE * 0.78
  const baseX = cx + ux * SIZE * 0.42
  const baseY = cy + uy * SIZE * 0.42
  const nx = -uy
  const ny = ux
  const head = 6
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI
  return (
    <g className="source-arrow" pointerEvents="none">
      <line
        x1={baseX}
        y1={baseY}
        x2={tipX - ux * 3}
        y2={tipY - uy * 3}
        className="source-arrow-shaft"
      />
      <polygon
        points={`${tipX},${tipY} ${tipX - ux * head + nx * 4.2},${tipY - uy * head + ny * 4.2} ${tipX - ux * head - nx * 4.2},${tipY - uy * head - ny * 4.2}`}
        className="source-arrow-head"
      />
      <g
        className="source-arrow-pulse"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        transform={`rotate(${angle} ${cx} ${cy})`}
      >
        <circle cx={cx + SIZE * 0.42} cy={cy} r={2} />
      </g>
    </g>
  )
}

function FreibeuterMarker({
  cx,
  cy,
  id,
  fee,
  index,
  total,
}: {
  cx: number
  cy: number
  id: string
  fee: number
  index: number
  total: number
}) {
  const ox = total > 1 ? (index - (total - 1) / 2) * SIZE * 0.32 : 0
  const px = cx + SIZE * 0.36 + ox
  const py = cy - SIZE * 0.42
  return (
    <g className="freibeuter-marker" transform={`translate(${px} ${py})`}>
      <title>{`${id}: Gebühr ${fee}`}</title>
      <circle r={11} className="freibeuter-disc" />
      <circle r={11} className="freibeuter-ring" />
      <text y={-1} className="freibeuter-id" textAnchor="middle">
        {id}
      </text>
      <text y={9} className="freibeuter-fee" textAnchor="middle">
        {fee}
      </text>
    </g>
  )
}

function ShipMarker({
  cx,
  cy,
  player,
  held,
  active,
  onPick,
}: {
  cx: number
  cy: number
  player: PlayerId
  held: boolean
  active: boolean
  onPick?: (e: MouseEvent) => void
}) {
  const sy = cy - SIZE * 0.5
  return (
    <g
      className={`ship ship-${player} ${held ? 'is-held' : ''} ${active ? 'is-active' : ''}`}
      style={{ transformOrigin: `${cx}px ${sy}px`, cursor: onPick ? 'pointer' : undefined }}
      onClick={onPick}
    >
      <circle cx={cx} cy={sy} r={18} className="ship-hit" />
      <ellipse
        cx={cx}
        cy={sy + 13}
        rx={6}
        ry={2.2}
        className="ship-shadow"
      />
      <g className="ship-hull" style={{ transformOrigin: `${cx}px ${sy}px` }}>
        <path
          d={`M${cx},${sy + 9} L${cx - 2.2},${sy + 12.5} L${cx + 2.2},${sy + 12.5} Z`}
          className="ship-flame"
        />
        <path
          d={`M${cx - 3.4},${sy + 3} L${cx - 8},${sy + 8.5} L${cx - 7.6},${sy + 10} L${cx - 3},${sy + 8} Z`}
          className="ship-wing"
        />
        <path
          d={`M${cx + 3.4},${sy + 3} L${cx + 8},${sy + 8.5} L${cx + 7.6},${sy + 10} L${cx + 3},${sy + 8} Z`}
          className="ship-wing"
        />
        <path
          d={`M${cx},${sy - 10} C${cx + 3.2},${sy - 6.5} ${cx + 4.2},${sy - 1} ${cx + 4},${sy + 5} L${cx + 2.6},${sy + 9} L${cx - 2.6},${sy + 9} L${cx - 4},${sy + 5} C${cx - 4.2},${sy - 1} ${cx - 3.2},${sy - 6.5} ${cx},${sy - 10} Z`}
          className="ship-body"
        />
        <ellipse
          cx={cx}
          cy={sy - 2.5}
          rx={1.9}
          ry={2.6}
          className="ship-window"
        />
        <line
          x1={cx}
          y1={sy + 1.5}
          x2={cx}
          y2={sy + 7}
          className="ship-seam"
        />
      </g>
    </g>
  )
}

function Routes({
  chips,
  phase,
  routes,
  onFollow,
}: {
  chips: Chip[]
  phase: string
  routes: Record<string, Route>
  onFollow: (dir: DirIndex) => void
}) {
  const flight = chips.find((c) => c.state === 'flying')
  const legal = new Map<string, DirIndex>()
  if (phase === 'simulate' && flight) {
    for (const d of DIRECTIONS) {
      const dest = neighbor(flight.hex, d.id)
      const key = edgeKey(flight.hex, dest)
      const route = routes[key]
      if (route && tierAllows(route.tier, flight.color)) legal.set(key, d.id)
    }
  }
  return (
    <g className="routes">
      {Object.entries(routes).map(([key, route]) => {
        const [a, b] = parseEdgeKey(key)
        const pa = axialToPixel(a, SIZE)
        const pb = axialToPixel(b, SIZE)
        const mx = (pa.x + pb.x) / 2
        const my = (pa.y + pb.y) / 2
        const dir = legal.get(key)
        return (
          <g
            key={key}
            className={`route route-${route.tier} ${dir ? 'is-legal' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              if (dir) onFollow(dir)
            }}
          >
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="route-hit" />
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="route-line" />
            <circle
              cx={mx}
              cy={my}
              r={8}
              className={`route-badge route-owner-${route.owner}`}
            />
            <text x={mx} y={my + 3} className="route-fee" textAnchor="middle">
              {route.fee}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export function HexBoard() {
  const cells = useGame((s) => s.cells)
  const chips = useGame((s) => s.chips)
  const ships = useGame((s) => s.ships)
  const freibeuters = useGame((s) => s.freibeuters)
  const playerIds = useGame((s) => s.playerIds)
  const selectedHex = useGame((s) => s.selectedHex)
  const selectedChipId = useGame((s) => s.selectedChipId)
  const heldShip = useGame((s) => s.heldShip)
  const developingSource = useGame((s) => s.developingSource)
  const buildAimHex = useGame((s) => s.buildAimHex)
  const phase = useGame((s) => s.phase)
  const activePlayer = useGame((s) => s.activePlayer)
  const developSource = useGame((s) => s.developSource)
  const selectHex = useGame((s) => s.selectHex)
  const placeKind = useGame((s) => s.placeKind)
  const placeField = useGame((s) => s.placeField)
  const removeChip = useGame((s) => s.removeChip)
  const selectAt = useGame((s) => s.selectAt)
  const pickShip = useGame((s) => s.pickShip)
  const moveShip = useGame((s) => s.moveShip)
  const takeSourceChip = useGame((s) => s.takeSourceChip)
  const upkeepPlayer = useGame((s) => s.upkeepPlayer)
  const closeForUpkeep = useGame((s) => s.closeForUpkeep)
  const routes = useGame((s) => s.routes)
  const followRoute = useGame((s) => s.followRoute)
  const simClick = useGame((s) => s.simClick)
  const endActions = useGame((s) => s.endActions)
  const passSimulation = useGame((s) => s.passSimulation)
  const simDone = useGame((s) => s.simDone)

  const layout = useMemo(() => {
    const list = Object.values(cells)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    const positioned = list.map((cell) => {
      const { x, y } = axialToPixel(cell.hex, SIZE)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      return { cell, x, y }
    })
    const pad = SIZE * 1.4
    return {
      positioned,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      ox: -minX + pad,
      oy: -minY + pad,
    }
  }, [cells])

  function canAimSource(cell: CellState): boolean {
    if (phase !== 'act' || !developingSource) return false
    if (!cell.revealed) return false
    if (
      cell.terrain !== 'uranium' &&
      cell.terrain !== 'sun' &&
      cell.terrain !== 'water'
    ) {
      return false
    }
    if (hexDistance(ships[activePlayer], cell.hex) > 1) return false
    return cell.sourceOwner == null || cell.sourceOwner === activePlayer
  }

  function isBuildAim(hex: Axial): boolean {
    return buildAimHex != null && hexEquals(buildAimHex, hex)
  }

  function closeOwnedFactory(hex: Axial): boolean {
    if (!upkeepPlayer) return false
    const cell = cells[hexKey(hex)]
    if (cell?.field?.owner !== upkeepPlayer) return false
    closeForUpkeep(hex)
    return true
  }

  function onHexClick(hex: Axial, e: MouseEvent) {
    e.stopPropagation()
    if (closeOwnedFactory(hex)) return
    if (phase === 'simulate') {
      simClick(hex)
      return
    }
    if (heldShip != null) {
      moveShip(hex, heldShip)
      return
    }
    if (selectedChipId) {
      selectAt(hex)
      return
    }
    if (selectedHex && hexEquals(selectedHex, hex)) {
      selectHex(null)
      return
    }
    selectHex(hex)
  }

  function onShipClick(player: PlayerId, hex: Axial, event: MouseEvent) {
    event.stopPropagation()
    if (phase !== 'act' || player !== activePlayer) {
      selectHex(hex)
      return
    }
    if (heldShip === player) moveShip(hex, player)
    else pickShip(player)
  }

  function pickOrMoveChip(hex: Axial) {
    if (phase === 'simulate') {
      simClick(hex)
      return
    }
    if (heldShip != null) moveShip(ships[heldShip], heldShip)
    selectAt(hex)
  }

  function onChipClick(hex: Axial, event: MouseEvent) {
    event.stopPropagation()
    pickOrMoveChip(hex)
  }

  function onBoardBackgroundClick() {
    if (phase !== 'act' && selectedChipId) removeChip(selectedChipId)
  }

  const wallPath = useMemo(() => {
    const keys = new Set(Object.keys(cells))
    if (keys.size === 0) return ''
    const segments: string[] = []
    for (const cell of Object.values(cells)) {
      const { x, y } = axialToPixel(cell.hex, SIZE)
      const corners = hexCorners(x, y, SIZE)
      for (let i = 0; i < DIRECTIONS.length; i++) {
        const dir = DIRECTIONS[i]!.id
        const n = neighbor(cell.hex, dir)
        if (keys.has(hexKey(n))) continue
        const a = corners[i]!
        const b = corners[(i + 1) % 6]!
        segments.push(`M${a.x},${a.y} L${b.x},${b.y}`)
      }
    }
    return segments.join(' ')
  }, [cells])

  const focus = useBoardFocus()
  const focusKey = focus ? hexKey(focus.hex) : null
  const [edgeFocus, setEdgeFocus] = useState<{ key: string; dir: DirIndex } | null>(null)
  const edgeDir = edgeFocus && edgeFocus.key === focusKey ? edgeFocus.dir : null
  function onEdge(dir: DirIndex | null) {
    setEdgeFocus(dir != null && focusKey ? { key: focusKey, dir } : null)
  }

  const camera = (() => {
    if (!focus) return 'translate(0px, 0px) scale(1)'
    const zoom = 1.75
    const p = axialToPixel(focus.hex, SIZE)
    const fx = layout.ox + p.x
    const fy = layout.oy + p.y
    const tx = layout.width / 2 - zoom * fx
    const ty = layout.height * 0.44 - zoom * fy
    return `translate(${tx}px, ${ty}px) scale(${zoom})`
  })()

  return (
    <div className="board-wrap" onClick={onBoardBackgroundClick}>
      <svg
        className={`hex-board ${focus ? 'is-focused' : ''}`}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Spielfeld"
      >
        <defs>
          <radialGradient id="boardGlow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="rgba(196, 163, 90, 0.12)" />
            <stop offset="55%" stopColor="rgba(20, 28, 36, 0.4)" />
            <stop offset="100%" stopColor="rgba(10, 14, 18, 0.9)" />
          </radialGradient>
          <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="shipGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="wallBlur" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <radialGradient id="chipBlue" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#8fc6e8" />
            <stop offset="55%" stopColor="#3a7ca5" />
            <stop offset="100%" stopColor="#1d4660" />
          </radialGradient>
          <radialGradient id="chipPurple" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#c7b0ea" />
            <stop offset="55%" stopColor="#7b5ea7" />
            <stop offset="100%" stopColor="#3f2d5c" />
          </radialGradient>
          <radialGradient id="chipRed" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#f0a898" />
            <stop offset="55%" stopColor="#c45c48" />
            <stop offset="100%" stopColor="#6a2a20" />
          </radialGradient>
          <radialGradient id="sunCore" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fff1c2" />
            <stop offset="55%" stopColor="#f0b84a" />
            <stop offset="100%" stopColor="#a85f1e" />
          </radialGradient>
          <radialGradient id="waterCore" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#bfe8f5" />
            <stop offset="55%" stopColor="#3f94b4" />
            <stop offset="100%" stopColor="#163a4a" />
          </radialGradient>
          <radialGradient id="uraniumCore" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#d6f5a8" />
            <stop offset="55%" stopColor="#7fb04a" />
            <stop offset="100%" stopColor="#2c4a1c" />
          </radialGradient>
          <linearGradient id="hexEmpty" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10161c" />
            <stop offset="100%" stopColor="#0c1116" />
          </linearGradient>
          <linearGradient id="hexFog" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0d1117" />
            <stop offset="100%" stopColor="#090c10" />
          </linearGradient>
        </defs>

        <rect
          width={layout.width}
          height={layout.height}
          fill="url(#boardGlow)"
        />

        <g className={`board-camera ${focus ? 'is-focused' : ''}`} style={{ transform: camera }}>
        <g transform={`translate(${layout.ox}, ${layout.oy})`}>
          <path
            d={wallPath}
            className="wall-haze"
            fill="none"
            stroke="rgba(196, 163, 90, 0.22)"
            strokeWidth={14}
            filter="url(#wallBlur)"
          />
          <path
            d={wallPath}
            className="wall-ring"
            fill="none"
            stroke="rgba(226, 197, 122, 0.55)"
            strokeWidth={1.6}
          />
          <path
            d={wallPath}
            className="wall-ring-dash"
            fill="none"
            stroke="rgba(226, 197, 122, 0.35)"
            strokeWidth={1}
            strokeDasharray="6 10"
          />

          {layout.positioned.map(({ cell, x, y }) => {
            const cx = x
            const cy = y
            const path = cornersToPath(hexCorners(cx, cy, SIZE - 1.2))
            const selected =
              selectedHex && hexEquals(selectedHex, cell.hex)
            const bound =
              cell.field?.charge ?? (cell.field ? [] : cell.sourceStock)
            const def = cell.field ? FIELD_DEFS[cell.field.kind] : null
            const critical =
              cell.revealed &&
              cell.terrain === 'planet' &&
              (cell.voltage <= -CRITICAL_LIMIT ||
                cell.voltage >= CRITICAL_LIMIT ||
                cell.water <= -CRITICAL_LIMIT ||
                cell.water >= CRITICAL_LIMIT ||
                cell.heat <= -CRITICAL_LIMIT ||
                cell.heat >= CRITICAL_LIMIT)
            const shipsHere = playerIds.filter((p) => hexEquals(ships[p], cell.hex))
            const piratesHere = freibeuters.filter((f) =>
              hexEquals(f.hex, cell.hex),
            )
            const stepTarget =
              phase === 'act' &&
              heldShip === activePlayer &&
              hexDistance(ships[activePlayer], cell.hex) === 1 &&
              cell.revealed &&
              cell.terrain !== 'mountain'

            const isSource =
              cell.revealed &&
              (cell.terrain === 'uranium' ||
                cell.terrain === 'sun' ||
                cell.terrain === 'water')
            const aiming = canAimSource(cell)
            const aimingFactory = isBuildAim(cell.hex)
            const markerOwner = cell.field?.owner ?? cell.sourceOwner
            const closing =
              upkeepPlayer != null && cell.field?.owner === upkeepPlayer
            const ring = focus ? hexDistance(focus.hex, cell.hex) : -1
            const focusClass = ring > 1 ? 'focus-far' : ring === 1 ? 'focus-near' : ''

            return (
              <g
                key={hexKey(cell.hex)}
                className={`hex-cell ${TERRAIN_CLASS[cell.terrain] ?? ''} is-revealed ${selected ? 'is-selected' : ''} ${markerOwner ? `owner-${markerOwner}` : ''} ${critical ? 'is-critical' : ''} ${closing ? 'is-upkeep' : ''} ${stepTarget ? 'is-step' : ''} ${focusClass}`}
                onClick={(e) => onHexClick(cell.hex, e)}
                style={{ cursor: 'pointer' }}
              >
                <path d={path} className="hex-face" />
                <path d={path} className="hex-inner" />
                <path d={path} className="hex-stroke" />

                {cell.terrain === 'mountain' && (
                  <Asteroid hex={cell.hex} cx={cx} cy={cy} />
                )}

                {cell.terrain === 'planet' && (
                  <PlanetDisc
                    name={cell.planetName}
                    cx={cx}
                    cy={cy}
                    owner={cell.planetOwner}
                  />
                )}

                {isSource && !cell.field && (
                  <g className="source-mark">
                    <SourceIcon
                      kind={cell.terrain as 'uranium' | 'sun' | 'water'}
                      cx={cx}
                      cy={cy - SIZE * 0.06}
                    />
                    <text
                      x={cx}
                      y={cy + SIZE * 0.28}
                      className="hex-label"
                      textAnchor="middle"
                    >
                      {cell.terrain === 'uranium'
                        ? 'Uran'
                        : cell.terrain === 'sun'
                          ? 'Sonne'
                          : 'Wasser'}
                    </text>
                    {cell.sourceDir && !aiming && (
                      <SourceArrow cx={cx} cy={cy} dir={cell.sourceDir} />
                    )}
                    {(cell.extractors ?? 0) > 0 && (
                      <text
                        x={cx}
                        y={cy + SIZE * 0.46}
                        className="hex-label"
                        textAnchor="middle"
                      >
                        {cell.extractors} Extr.
                      </text>
                    )}
                    {cell.sourceOwner && (
                      <OwnerPip
                        cx={cx + SIZE * 0.48}
                        cy={cy - SIZE * 0.42}
                        owner={cell.sourceOwner}
                      />
                    )}
                    {cell.sourceOwner != null && (
                      <FeeMark
                        cx={cx - SIZE * 0.46}
                        cy={cy - SIZE * 0.38}
                        fee={cell.sourceFee ?? 0}
                        label="Abbaugebühr"
                      />
                    )}
                  </g>
                )}

                {def && (
                  <g className="field-badge">
                    <circle
                      cx={cx}
                      cy={cy - SIZE * 0.08}
                      r={SIZE * 0.3}
                      className="field-ring"
                      style={{ stroke: def.accent }}
                    />
                    <circle
                      cx={cx}
                      cy={cy - SIZE * 0.08}
                      r={SIZE * 0.3}
                      className="field-ring-glow"
                      style={{ fill: def.accent }}
                    />
                    <text
                      x={cx}
                      y={cy - SIZE * 0.08 + 5}
                      className="field-icon"
                      textAnchor="middle"
                    >
                      {def.icon}
                    </text>
                    <text
                      x={cx}
                      y={cy + SIZE * 0.3}
                      className="field-label"
                      textAnchor="middle"
                      fill={def.accent}
                    >
                      {def.short}
                    </text>
                    {cell.field?.dir && !aimingFactory && (
                      <SourceArrow cx={cx} cy={cy} dir={cell.field.dir} />
                    )}
                    <text
                      x={cx - SIZE * 0.46}
                      y={cy - SIZE * 0.34}
                      className="field-fee"
                      textAnchor="middle"
                    >
                      {cell.field?.fee ?? 0}
                    </text>
                    {cell.field && cell.field.owner != null && (
                      <OwnerPip
                        cx={cx + SIZE * 0.48}
                        cy={cy - SIZE * 0.38}
                        owner={cell.field.owner}
                      />
                    )}
                  </g>
                )}

                {/* Bound charges only — free chips are drawn above ships for click targeting */}
                {cell.revealed && (
                  <ChipDots
                    colors={bound}
                    cx={cx}
                    cy={cy}
                    bound
                    onPick={(index) => {
                      const source =
                        cell.terrain === 'sun' ||
                        cell.terrain === 'water' ||
                        cell.terrain === 'uranium'
                      if (phase === 'simulate' && source) takeSourceChip(cell.hex, index)
                      else pickOrMoveChip(cell.hex)
                    }}
                  />
                )}

                {shipsHere.length > 0 && (
                  <g className="ship-marker" filter="url(#shipGlow)">
                    {shipsHere.map((player, index) => {
                      const recess =
                        phase === 'act' &&
                        heldShip == null &&
                        selected &&
                        activePlayer === player
                      const offset =
                        shipsHere.length > 1
                          ? (index - (shipsHere.length - 1) / 2) * SIZE * 0.35
                          : 0
                      const tuck = `translate(${cx - SIZE * 0.28 + offset} ${cy + SIZE * 0.22}) scale(0.78) translate(${-cx} ${-cy})`
                      const shift =
                        offset !== 0
                          ? `translate(${offset} 0)`
                          : undefined
                      return (
                        <g
                          key={player}
                          className={recess ? 'is-recessed' : undefined}
                          transform={recess ? tuck : shift}
                        >
                          <ShipMarker
                            cx={cx}
                            cy={cy}
                            player={player}
                            held={heldShip === player}
                            active={activePlayer === player}
                            onPick={(e) => onShipClick(player, cell.hex, e)}
                          />
                        </g>
                      )
                    })}
                  </g>
                )}

                {piratesHere.length > 0 && (
                  <g className="freibeuter-layer">
                    {piratesHere.map((f, index) => (
                      <FreibeuterMarker
                        key={f.id}
                        cx={cx}
                        cy={cy}
                        id={f.id}
                        fee={f.fee}
                        index={index}
                        total={piratesHere.length}
                      />
                    ))}
                  </g>
                )}

                {cell.revealed && cell.terrain === 'planet' && (
                  <text
                    x={cx}
                    y={cy + SIZE * 0.66}
                    className="planet-hex-name"
                    textAnchor="middle"
                  >
                    {cell.planetName ?? 'Planet'}
                  </text>
                )}
                {cell.revealed &&
                  cell.terrain === 'planet' &&
                  cell.planetOwner != null && (
                    <FeeMark
                      cx={cx - SIZE * 0.46}
                      cy={cy - SIZE * 0.38}
                      fee={cell.importFee ?? 0}
                      label="Importzoll"
                    />
                  )}
              </g>
            )
          })}

          <g className={focus ? 'layer-dim' : undefined}>
          <Routes
            chips={chips}
            phase={phase}
            routes={routes}
            onFollow={followRoute}
          />

          {chips
            .filter((c) => c.state === 'flying' || c.state === 'free')
            .map((chip) => {
              const { x, y } = axialToPixel(chip.hex, SIZE)
              const selected = chip.id === selectedChipId
              const oy = SIZE * 0.5
              const px = x
              const py = y + oy
              return (
                <g
                  key={chip.id}
                  className={`flying-chip chip-${chip.color} ${selected ? 'is-selected' : ''} ${chip.state === 'flying' ? 'is-flying' : ''}`}
                  onClick={(e) => onChipClick(chip.hex, e)}
                  style={{
                    cursor: 'pointer',
                    transformOrigin: `${px}px ${py}px`,
                  }}
                >
                  <circle
                    cx={px}
                    cy={py}
                    r={13}
                    className="flying-chip-aura"
                    style={{ fill: CHIP_FILL[chip.color] }}
                  />
                  {selected && (
                    <circle
                      cx={px}
                      cy={py}
                      r={11.5}
                      className="flying-chip-ring"
                    />
                  )}
                  <circle
                    cx={px}
                    cy={py}
                    r={8}
                    fill={CHIP_GRADIENT[chip.color]}
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth={selected ? 2 : 1.3}
                  />
                  <ellipse
                    cx={px - 2.4}
                    cy={py - 3}
                    rx={2.6}
                    ry={1.5}
                    className="flying-chip-shine"
                  />
                </g>
              )
            })}
          </g>

          {focus && <RouteChoices cell={focus} edgeDir={edgeDir} onEdge={onEdge} />}

          {layout.positioned.map(({ cell, x, y }) => {
            if (canAimSource(cell)) {
              return (
                <SourceAimRing
                  key={`aim-${hexKey(cell.hex)}`}
                  cx={x}
                  cy={y}
                  current={cell.sourceDir}
                  onPick={(dir) => developSource(cell.hex, dir)}
                />
              )
            }
            if (isBuildAim(cell.hex)) {
              return (
                <SourceAimRing
                  key={`build-${hexKey(cell.hex)}`}
                  cx={x}
                  cy={y}
                  onPick={(dir) => placeField(cell.hex, placeKind, activePlayer, dir)}
                />
              )
            }
            return null
          })}
        </g>
        </g>
      </svg>
      <ActionBar edgeDir={edgeDir} onEdge={onEdge} />
      <div
        className="board-dock"
        onClick={(event) => event.stopPropagation()}
      >
        {phase === 'act' && (
          <button type="button" className="dock-btn" onClick={endActions}>
            Aktionen beenden
          </button>
        )}
        {phase === 'simulate' && !simDone && !chips.some((chip) => chip.state === 'flying') && (
          <button type="button" className="dock-btn" onClick={passSimulation}>
            Passen
          </button>
        )}
      </div>
    </div>
  )
}
