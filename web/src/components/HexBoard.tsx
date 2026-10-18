import { useMemo, type MouseEvent } from 'react'
import {
  BOARD_RADIUS,
  CRITICAL_LIMIT,
  ZONE_SHORT,
  zoneOf,
} from '../data/boardLayout'
import { FIELD_DEFS } from '../data/fields'
import {
  axialToPixel,
  cornersToPath,
  edgeMidpoint,
  hexCorners,
  hexDistance,
  hexEquals,
  hexKey,
} from '../hex/math'
import { planetHue } from '../data/planetNames'
import { useGame } from '../state/gameStore'
import { DIRECTIONS, type Axial, type CellState, type ChipColor, type DirIndex, type PlayerId } from '../types'
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

function FogStars({ hex, cx, cy }: { hex: Axial; cx: number; cy: number }) {
  const stars = [0, 1, 2].map((i) => {
    const a = hexNoise(hex, i) * Math.PI * 2
    const d = (0.18 + hexNoise(hex, i + 10) * 0.42) * SIZE
    return {
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d,
      r: 0.6 + hexNoise(hex, i + 20) * 0.9,
      delay: hexNoise(hex, i + 30) * 4,
    }
  })
  return (
    <g className="fog-stars">
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          className="fog-star"
          style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
    </g>
  )
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
}: {
  colors: ChipColor[]
  cx: number
  cy: number
  bound: boolean
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

export function HexBoard() {
  const cells = useGame((s) => s.cells)
  const chips = useGame((s) => s.chips)
  const ships = useGame((s) => s.ships)
  const selectedHex = useGame((s) => s.selectedHex)
  const selectedChipId = useGame((s) => s.selectedChipId)
  const heldShip = useGame((s) => s.heldShip)
  const tool = useGame((s) => s.tool)
  const placeKind = useGame((s) => s.placeKind)
  const approveType = useGame((s) => s.approveType)
  const developingSource = useGame((s) => s.developingSource)
  const buildAimHex = useGame((s) => s.buildAimHex)
  const phase = useGame((s) => s.phase)
  const activePlayer = useGame((s) => s.activePlayer)
  const developSource = useGame((s) => s.developSource)
  const aimFactory = useGame((s) => s.aimFactory)
  const armFactoryBuild = useGame((s) => s.armFactoryBuild)
  const selectHex = useGame((s) => s.selectHex)
  const placeField = useGame((s) => s.placeField)
  const approveConsumer = useGame((s) => s.approveConsumer)
  const selectAt = useGame((s) => s.selectAt)
  const pickShip = useGame((s) => s.pickShip)
  const removeAt = useGame((s) => s.removeAt)
  const draftFee = useGame((s) => s.draftFee)
  const setFactoryFee = useGame((s) => s.setFactoryFee)
  const removeChip = useGame((s) => s.removeChip)
  const upkeepPlayer = useGame((s) => s.upkeepPlayer)
  const closeForUpkeep = useGame((s) => s.closeForUpkeep)

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

  function canAimFactory(cell: CellState): boolean {
    if (phase !== 'act' || !developingSource || !cell.revealed || !cell.field) {
      return false
    }
    return (
      cell.field.owner === activePlayer &&
      hexDistance(ships[activePlayer], cell.hex) <= 1
    )
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
    selectHex(hex)
    const cell = cells[hexKey(hex)]
    if (!cell) return

    if (tool === 'select') {
      selectAt(hex)
      return
    }
    if (tool === 'place') {
      if (approveType) {
        if (cell.terrain === 'planet') approveConsumer(hex, approveType)
        return
      }
      const isSource =
        cell.revealed &&
        (cell.terrain === 'uranium' ||
          cell.terrain === 'sun' ||
          cell.terrain === 'water')
      if (developingSource || isSource) return
      const def = FIELD_DEFS[placeKind]
      const recharging =
        cell.field?.kind === placeKind && def.startCharge > 0
      if (recharging) {
        placeField(hex, placeKind, activePlayer)
        return
      }
      armFactoryBuild(hex)
      return
    }
    if (tool === 'remove') {
      removeAt(hex)
      return
    }
    if (tool === 'fee') {
      setFactoryFee(hex, draftFee)
    }
  }

  /** Click off the hex grid (wall / padding) while holding a chip → Beutel. */
  function onBoardBackgroundClick() {
    if (selectedChipId) removeChip(selectedChipId)
  }

  const wallR = SIZE * (BOARD_RADIUS * 1.5 + 0.85)
  const wallPath = cornersToPath(hexCorners(0, 0, wallR))

  return (
    <div className="board-wrap" onClick={onBoardBackgroundClick}>
      <svg
        className="hex-board"
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
            <stop offset="0%" stopColor="#1b232c" />
            <stop offset="100%" stopColor="#141b22" />
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
            const hasShip1 = hexEquals(ships[1], cell.hex)
            const hasShip2 = hexEquals(ships[2], cell.hex)
            const nearActive =
              hexDistance(ships[activePlayer], cell.hex) === 1
            const zone = zoneOf(cell.hex)

            const isSource =
              cell.revealed &&
              (cell.terrain === 'uranium' ||
                cell.terrain === 'sun' ||
                cell.terrain === 'water')
            const aiming = canAimSource(cell)
            const aimingFactory = canAimFactory(cell) || isBuildAim(cell.hex)
            const markerOwner = cell.field?.owner ?? cell.sourceOwner
            const closing =
              upkeepPlayer != null && cell.field?.owner === upkeepPlayer

            return (
              <g
                key={`${hexKey(cell.hex)}-${cell.revealed ? 'r' : 'f'}`}
                className={`hex-cell zone-${zone} ${cell.revealed ? TERRAIN_CLASS[cell.terrain] ?? '' : 'terrain-fog'} ${cell.revealed ? 'is-revealed' : ''} ${selected ? 'is-selected' : ''} ${markerOwner ? `owner-${markerOwner}` : ''} ${critical ? 'is-critical' : ''} ${closing ? 'is-upkeep' : ''} ${nearActive && !cell.revealed ? 'is-explorable' : ''}`}
                onClick={(e) => onHexClick(cell.hex, e)}
                style={{ cursor: 'pointer' }}
              >
                <path d={path} className="hex-face" />
                <path d={path} className="hex-inner" />
                <path d={path} className="hex-stroke" />

                {!cell.revealed && <FogStars hex={cell.hex} cx={cx} cy={cy} />}
                {!cell.revealed && (
                  <text
                    x={cx}
                    y={cy + SIZE * 0.42}
                    className={`zone-tag zone-tag-${zone}`}
                    textAnchor="middle"
                  >
                    {ZONE_SHORT[zone]}
                  </text>
                )}

                {cell.revealed && cell.terrain === 'mountain' && (
                  <Asteroid hex={cell.hex} cx={cx} cy={cy} />
                )}

                {cell.revealed && cell.terrain === 'planet' && (
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
                    {cell.sourceOwner && (
                      <OwnerPip
                        cx={cx + SIZE * 0.48}
                        cy={cy - SIZE * 0.42}
                        owner={cell.sourceOwner}
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
                    <OwnerPip
                      cx={cx + SIZE * 0.48}
                      cy={cy - SIZE * 0.38}
                      owner={cell.field!.owner}
                    />
                  </g>
                )}

                {/* Bound charges only — free chips are drawn above ships for click targeting */}
                {cell.revealed && (
                  <ChipDots colors={bound} cx={cx} cy={cy} bound />
                )}

                {(hasShip1 || hasShip2) && (
                  <g className="ship-marker" filter="url(#shipGlow)">
                    {hasShip1 && (
                      <ShipMarker
                        cx={cx}
                        cy={cy}
                        player={1}
                        held={heldShip === 1}
                        active={activePlayer === 1}
                        onPick={(e) => {
                          e.stopPropagation()
                          if (closeOwnedFactory(cell.hex)) return
                          selectHex(cell.hex)
                          if (tool === 'select') pickShip(1)
                          else if (tool === 'remove') removeAt(cell.hex)
                          else if (tool === 'fee') setFactoryFee(cell.hex, draftFee)
                        }}
                      />
                    )}
                    {hasShip2 && (
                      <ShipMarker
                        cx={cx}
                        cy={cy}
                        player={2}
                        held={heldShip === 2}
                        active={activePlayer === 2}
                        onPick={(e) => {
                          e.stopPropagation()
                          if (closeOwnedFactory(cell.hex)) return
                          selectHex(cell.hex)
                          if (tool === 'select') pickShip(2)
                          else if (tool === 'remove') removeAt(cell.hex)
                          else if (tool === 'fee') setFactoryFee(cell.hex, draftFee)
                        }}
                      />
                    )}
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
              </g>
            )
          })}

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
                  onClick={(e) => {
                    e.stopPropagation()
                    if (closeOwnedFactory(chip.hex)) return
                    selectHex(chip.hex)
                    if (tool === 'select') {
                      selectAt(chip.hex)
                      return
                    }
                    if (tool === 'remove') {
                      removeAt(chip.hex)
                      return
                    }
                    if (tool === 'fee') setFactoryFee(chip.hex, draftFee)
                  }}
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
            if (canAimFactory(cell)) {
              return (
                <SourceAimRing
                  key={`factory-${hexKey(cell.hex)}`}
                  cx={x}
                  cy={y}
                  current={cell.field?.dir}
                  onPick={(dir) => aimFactory(cell.hex, dir)}
                />
              )
            }
            return null
          })}
        </g>
      </svg>
    </div>
  )
}
