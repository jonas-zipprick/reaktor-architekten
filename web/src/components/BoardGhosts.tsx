import type { ReactNode } from 'react'
import { CONSUMER_COST, EXTRACTOR_COST, TRAFO_RELOAD_COST } from '../data/boardLayout'
import { FIELD_DEFS } from '../data/fields'
import { METER_LABELS, RESOURCE_LABELS, playerLabel } from '../data/labels'
import { axialToPixel, edgeKey, hexDistance, hexKey, neighbor } from '../hex/math'
import { factoryEffect, ROUTE_BUILD_COST, TIER_LABEL, upgradeCost } from '../state/simRules'
import { useGame } from '../state/gameStore'
import {
  DIRECTIONS,
  type CellState,
  type ChipColor,
  type DirIndex,
  type MeterKind,
  type RouteTier,
} from '../types'

const SIZE = 42
const FEES = [0, 1, 2, 3, 4] as const
const TIERS: RouteTier[] = ['blue', 'purple', 'red']
const TRIO = [
  { dx: -12, dy: -9 },
  { dx: 12, dy: -9 },
  { dx: 0, dy: 12 },
]
const CONSUMERS: MeterKind[] = ['water', 'heat', 'voltage']
const COLOR_DE: Record<ChipColor, string> = { blue: 'Blau', purple: 'Lila', red: 'Rot' }

function isSource(cell: CellState): boolean {
  return cell.terrain === 'sun' || cell.terrain === 'water' || cell.terrain === 'uranium'
}

function cellTitle(cell: CellState): string {
  if (!cell.revealed) return 'Unentdecktes Feld'
  if (cell.field) return FIELD_DEFS[cell.field.kind].name
  if (cell.terrain === 'planet') return cell.planetName ?? 'Planet'
  if (cell.terrain === 'sun') return 'Sonnenquelle'
  if (cell.terrain === 'water') return 'Wasserquelle'
  if (cell.terrain === 'uranium') return 'Uranquelle'
  if (cell.terrain === 'mountain') return 'Asteroid'
  return 'Leeres Feld'
}

function cellOwner(cell: CellState) {
  if (cell.field) return cell.field.owner ?? null
  if (cell.terrain === 'planet') return cell.planetOwner ?? null
  if (isSource(cell)) return cell.sourceOwner ?? null
  return undefined
}

/** True while the clicked field owns the board focus (zoom + blur). */
export function useBoardFocus(): CellState | null {
  const phase = useGame((s) => s.phase)
  const heldShip = useGame((s) => s.heldShip)
  const selectedChipId = useGame((s) => s.selectedChipId)
  const selectedHex = useGame((s) => s.selectedHex)
  const cells = useGame((s) => s.cells)
  if (phase !== 'act' || heldShip != null || selectedChipId || !selectedHex) return null
  const cell = cells[hexKey(selectedHex)]
  return cell?.revealed ? cell : null
}

function RouteButton({
  x,
  y,
  label,
  title,
  tone,
  wide = false,
  current = false,
  onClick,
}: {
  x: number
  y: number
  label: string
  title: string
  tone: string
  wide?: boolean
  current?: boolean
  onClick: () => void
}) {
  return (
    <g
      className={`route-choice tone-${tone} ${current ? 'is-current' : ''}`}
      role="button"
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <title>{title}</title>
      {wide ? (
        <rect x={x - 21} y={y - 10} width={42} height={20} rx={10} className="route-choice-face" />
      ) : (
        <circle cx={x} cy={y} r={10.5} className="route-choice-face" />
      )}
      <text x={x} y={y + 3.6} textAnchor="middle" className="route-choice-label">
        {label}
      </text>
    </g>
  )
}

/** Route offers sit inside each neighbor field, one field = one direction. */
export function RouteChoices({
  cell,
  edgeDir,
  onEdge,
}: {
  cell: CellState
  edgeDir: DirIndex | null
  onEdge: (dir: DirIndex | null) => void
}) {
  const cells = useGame((s) => s.cells)
  const routes = useGame((s) => s.routes)
  const ships = useGame((s) => s.ships)
  const activePlayer = useGame((s) => s.activePlayer)
  const buildRoute = useGame((s) => s.buildRoute)

  if (cell.terrain === 'mountain') return null
  if (hexDistance(ships[activePlayer], cell.hex) > 1) return null
  const from = axialToPixel(cell.hex, SIZE)

  return (
    <g className="route-choices">
      {DIRECTIONS.map((d) => {
        const dest = neighbor(cell.hex, d.id)
        const other = cells[hexKey(dest)]
        if (!other?.revealed || other.terrain === 'mountain') return null
        const route = routes[edgeKey(cell.hex, dest)]
        const to = axialToPixel(dest, SIZE)
        if (!route) {
          return (
            <g key={d.id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="route-choice-preview"
              />
              {TIERS.map((tier, index) => (
                <RouteButton
                  key={tier}
                  x={to.x + TRIO[index].dx}
                  y={to.y + TRIO[index].dy}
                  label={String(ROUTE_BUILD_COST[tier])}
                  title={`${TIER_LABEL[tier]}er Weg nach ${d.label}, ${ROUTE_BUILD_COST[tier]} Geld`}
                  tone={tier}
                  onClick={() => buildRoute(cell.hex, d.id, tier)}
                />
              ))}
            </g>
          )
        }
        if (route.owner !== activePlayer) return null
        return (
          <RouteButton
            key={d.id}
            x={to.x}
            y={to.y}
            wide
            label="Weg"
            title={`Eigener Weg nach ${d.label}: Gebühr, Aufwerten, Abbau`}
            tone={route.tier}
            current={edgeDir === d.id}
            onClick={() => onEdge(edgeDir === d.id ? null : d.id)}
          />
        )
      })}
    </g>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="action-group">
      <span className="action-group-label">{label}</span>
      <div className="action-group-buttons">{children}</div>
    </div>
  )
}

function Act({
  children,
  onClick,
  tone = 'plain',
  current = false,
  title,
}: {
  children: ReactNode
  onClick: () => void
  tone?: string
  current?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      className={`action-btn tone-${tone} ${current ? 'is-current' : ''}`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function FeeRow({ current, onPick }: { current: number; onPick: (fee: number) => void }) {
  return (
    <>
      {FEES.map((fee) => (
        <Act key={fee} current={current === fee} onClick={() => onPick(fee)}>
          {fee}
        </Act>
      ))}
    </>
  )
}

/** High-contrast context bar for the focused field or the chip in flight. */
export function ActionBar({
  edgeDir,
  onEdge,
}: {
  edgeDir: DirIndex | null
  onEdge: (dir: DirIndex | null) => void
}) {
  const phase = useGame((s) => s.phase)
  const activePlayer = useGame((s) => s.activePlayer)
  const ships = useGame((s) => s.ships)
  const cells = useGame((s) => s.cells)
  const routes = useGame((s) => s.routes)
  const chips = useGame((s) => s.chips)
  const offers = useGame((s) => s.offers)
  const selectedHex = useGame((s) => s.selectedHex)
  const selectHex = useGame((s) => s.selectHex)
  const setRouteFee = useGame((s) => s.setRouteFee)
  const upgradeRoute = useGame((s) => s.upgradeRoute)
  const removeRoute = useGame((s) => s.removeRoute)
  const setSourceFee = useGame((s) => s.setSourceFee)
  const setFactoryFee = useGame((s) => s.setFactoryFee)
  const setImportFee = useGame((s) => s.setImportFee)
  const buildExtractor = useGame((s) => s.buildExtractor)
  const approveConsumer = useGame((s) => s.approveConsumer)
  const claimFacility = useGame((s) => s.claimFacility)
  const declineOffer = useGame((s) => s.declineOffer)
  const abandonFacility = useGame((s) => s.abandonFacility)
  const rechargeTransformer = useGame((s) => s.rechargeTransformer)
  const takeSourceChip = useGame((s) => s.takeSourceChip)
  const releaseStorage = useGame((s) => s.releaseStorage)
  const trigger = useGame((s) => s.triggerFactoryEffect)
  const deliver = useGame((s) => s.deliverChip)
  const abort = useGame((s) => s.abortChipTransport)
  const focus = useBoardFocus()

  const flight = chips.find((chip) => chip.state === 'flying')

  if (phase === 'simulate' && flight) {
    const cell = cells[hexKey(flight.hex)]
    const effect = cell?.field ? factoryEffect(cell.field, flight) : null
    const payer = flight.pilot ?? activePlayer
    const supply =
      flight.resource === 'voltage' || flight.resource === 'water' || flight.resource === 'heat'
    const tariff =
      cell?.planetOwner && cell.planetOwner !== payer ? (cell.importFee ?? 0) : 0
    const fieldFee =
      cell?.field && cell.field.owner !== payer ? (cell.field.fee ?? 0) : 0
    return (
      <Bar
        title={`Chip ${COLOR_DE[flight.color]}${flight.resource ? ` · ${RESOURCE_LABELS[flight.resource]}` : ''}`}
        hint="Weiterfliegen: eine leuchtende Route antippen."
      >
        {effect && (
          <Group label="Fabrik">
            <Act tone="build" onClick={trigger}>
              {effect.label}
              {fieldFee > 0 ? ` · ${fieldFee} Geld` : ''}
            </Act>
          </Group>
        )}
        {supply && cell?.terrain === 'planet' && (
          <Group label="Planet">
            <Act tone="build" onClick={() => deliver(true)}>
              {tariff > 0 ? `Liefern · Zoll ${tariff}` : 'Liefern'}
            </Act>
            {tariff > 0 && <Act onClick={() => deliver(false)}>Ohne Zoll</Act>}
          </Group>
        )}
        <Group label="Chip">
          <Act tone="danger" onClick={abort}>
            Abbrechen
          </Act>
        </Group>
      </Bar>
    )
  }

  if (phase === 'simulate' && selectedHex) {
    const cell = cells[hexKey(selectedHex)]
    if (!cell) return null
    const stock = isSource(cell) && cell.sourceOwner != null ? cell.sourceStock : []
    const canRelease =
      cell.field?.kind === 'pumped' &&
      cell.field.charge.length > 0 &&
      (cell.field.storedBy ?? cell.field.owner) === activePlayer
    if (stock.length === 0 && !canRelease) return null
    const fee =
      cell.sourceOwner && cell.sourceOwner !== activePlayer ? (cell.sourceFee ?? 0) : 0
    return (
      <Bar title={cellTitle(cell)} onClose={() => selectHex(null)}>
        {stock.length > 0 && (
          <Group label={fee > 0 ? `Entnehmen · ${fee} Geld` : 'Entnehmen'}>
            {stock.map((color, index) => (
              <Act key={`${color}-${index}`} tone={color} onClick={() => takeSourceChip(cell.hex, index)}>
                {COLOR_DE[color]}
              </Act>
            ))}
          </Group>
        )}
        {canRelease && (
          <Group label="Speicher">
            <Act tone="build" onClick={() => releaseStorage(cell.hex)}>
              Ladung freigeben
            </Act>
          </Group>
        )}
      </Bar>
    )
  }

  if (!focus) return null
  const cell = focus
  const ship = ships[activePlayer]
  const distance = hexDistance(ship, cell.hex)
  const inRange = distance <= 1
  const owner = cellOwner(cell)
  const mine = owner === activePlayer
  const neutralFacility = owner === null
  const offer = offers.find(
    (item) => item.player === activePlayer && item.hex.q === cell.hex.q && item.hex.r === cell.hex.r,
  )

  const edgeRoute =
    edgeDir != null ? routes[edgeKey(cell.hex, neighbor(cell.hex, edgeDir))] : undefined
  const edgeLabel = DIRECTIONS.find((d) => d.id === edgeDir)?.label

  const fee = isSource(cell)
    ? (cell.sourceFee ?? 0)
    : cell.field
      ? (cell.field.fee ?? 0)
      : (cell.importFee ?? 0)
  function pickFee(next: number) {
    if (cell.field) setFactoryFee(cell.hex, next)
    else if (isSource(cell)) setSourceFee(cell.hex, next)
    else setImportFee(cell.hex, next)
  }

  const ownerText =
    owner === undefined ? '' : owner === null ? ' · neutral' : ` · ${playerLabel(owner)}`
  const extractors = cell.extractors ?? 0

  return (
    <Bar
      title={`${cellTitle(cell)}${ownerText}`}
      sub={isSource(cell) && mine ? `${extractors} Extraktor${extractors === 1 ? '' : 'en'}` : undefined}
      onClose={() => selectHex(null)}
    >
      {edgeRoute && edgeRoute.owner === activePlayer && edgeDir != null && (
        <Group label={`Weg ${edgeLabel} · ${TIER_LABEL[edgeRoute.tier]}`}>
          <FeeRow
            current={edgeRoute.fee}
            onPick={(next) => setRouteFee(cell.hex, edgeDir, next)}
          />
          {TIERS.filter((tier) => upgradeCost(edgeRoute.tier, tier) != null).map((tier) => (
            <Act key={tier} tone={tier} onClick={() => upgradeRoute(cell.hex, edgeDir, tier)}>
              {TIER_LABEL[tier]} · {upgradeCost(edgeRoute.tier, tier)}
            </Act>
          ))}
          <Act
            tone="danger"
            onClick={() => {
              removeRoute(cell.hex, edgeDir)
              onEdge(null)
            }}
          >
            Abbauen
          </Act>
        </Group>
      )}

      {neutralFacility && distance === 0 && (
        <Group label="Übernahme">
          <Act tone="build" onClick={() => claimFacility(cell.hex)}>
            Übernehmen
          </Act>
          {offer && <Act onClick={() => declineOffer(offer.id)}>Neutral lassen</Act>}
        </Group>
      )}

      {mine && (
        <Group label={isSource(cell) ? 'Abbaugebühr' : cell.field ? 'Gebühr' : 'Importzoll'}>
          <FeeRow current={fee} onPick={pickFee} />
        </Group>
      )}

      {mine && inRange && isSource(cell) && (
        <Group label="Extraktor">
          <Act tone="build" onClick={() => buildExtractor(cell.hex)}>
            + Extraktor · {EXTRACTOR_COST}
          </Act>
        </Group>
      )}

      {mine && inRange && cell.terrain === 'planet' && !cell.field && (
        <Group label={`Verbraucher · ${CONSUMER_COST} Geld`}>
          {CONSUMERS.map((type) => (
            <Act key={type} tone={`meter-${type}`} onClick={() => approveConsumer(cell.hex, type)}>
              {METER_LABELS[type]}
            </Act>
          ))}
        </Group>
      )}

      {mine && inRange && cell.field?.kind === 'transformer' && cell.field.charge.length < 4 && (
        <Group label="Trafo">
          <Act tone="build" onClick={() => rechargeTransformer(cell.hex)}>
            Aufladen · {TRAFO_RELOAD_COST}
          </Act>
        </Group>
      )}

      {mine && (
        <Group label="Besitz">
          <Act tone="danger" onClick={() => abandonFacility(cell.hex)}>
            Aufgeben
          </Act>
        </Group>
      )}
    </Bar>
  )
}

function Bar({
  title,
  sub,
  hint,
  onClose,
  children,
}: {
  title: string
  sub?: string
  hint?: string
  onClose?: () => void
  children?: ReactNode
}) {
  return (
    <div className="action-bar" onClick={(event) => event.stopPropagation()}>
      <div className="action-bar-head">
        <strong>{title}</strong>
        {sub && <span className="action-bar-sub">{sub}</span>}
        {onClose && (
          <button type="button" className="action-close" title="Schließen (Esc)" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      {hint && <p className="action-bar-hint">{hint}</p>}
      {children && <div className="action-bar-body">{children}</div>}
    </div>
  )
}
