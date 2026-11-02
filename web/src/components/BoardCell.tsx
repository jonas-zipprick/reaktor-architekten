import type { MouseEvent } from 'react'
import type { CellState, PlayerId } from '../types'
import { PlayingCard, type DefenseAllegiance } from './PlayingCard'
import './BoardCell.css'

const kindLabel: Record<CellState['kind'], string> = {
  empty: '',
  sun: 'Sonne',
  planet: 'Planet',
  storage: 'Speicher',
  base: 'Basis',
  asteroid: 'Asteroid',
}

const TENSION_MIN = -6
const TENSION_MAX = 6

function tollTone(
  owner: CellState['owner'],
  currentPlayerId: PlayerId,
): 'own' | 'enemy' | 'neutral' {
  if (owner === currentPlayerId) return 'own'
  if (owner === 'neutral' || owner == null) return 'neutral'
  return 'enemy'
}

function TensionMeter({
  value,
  flash = false,
  flashKey = 0,
  limitPulse = false,
}: {
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
}) {
  const clamped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, value))
  const steps = TENSION_MAX - TENSION_MIN + 1
  const stoneIndex = clamped - TENSION_MIN
  const danger = Math.abs(clamped) >= 5
  const valueLabel = clamped > 0 ? `+${clamped}` : String(clamped)

  return (
    <div
      key={flash ? `flash-${flashKey}` : 'meter'}
      className={`tension-meter ${danger ? 'danger' : ''} ${flash ? 'demand-pulse' : ''} ${limitPulse ? 'limit-pulse' : ''}`}
      title={`Spannung ${valueLabel}`}
      aria-label={`Spannungsmesser ${valueLabel}`}
    >
      <div className="tension-scale">
        {Array.from({ length: steps }, (_, i) => {
          const mark = TENSION_MIN + i
          const major =
            mark === TENSION_MIN || mark === 0 || mark === TENSION_MAX
          return (
            <span
              key={mark}
              className={[
                'tension-tick',
                major ? 'major' : 'minor',
                mark === 0 ? 'zero' : '',
                mark === clamped ? 'active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <i className="tension-line" aria-hidden />
              <em>{mark}</em>
            </span>
          )
        })}
        <span
          className="tension-stone"
          style={{
            left: `${(stoneIndex / (steps - 1)) * 100}%`,
          }}
        />
      </div>
      <span className="tension-value">{valueLabel}</span>
    </div>
  )
}

export function BoardCell({
  cell,
  selectedCount,
  currentPlayerId,
  demandFlash = false,
  demandFlashKey = 0,
  limitFlash = false,
  limitFlashKey = 0,
  onPath,
  waypoint,
  pathCost,
  onClick,
  onMouseEnter,
}: {
  cell: CellState
  selectedCount: number
  currentPlayerId: PlayerId
  demandFlash?: boolean
  demandFlashKey?: number
  limitFlash?: boolean
  limitFlashKey?: number
  onPath: boolean
  waypoint: number | null
  pathCost: number | null
  onClick: (e: MouseEvent) => void
  onMouseEnter: () => void
}) {
  const isSelected = selectedCount !== 0
  const ownerClass =
    cell.owner && cell.owner !== 'neutral' ? `owner-${cell.owner}` : ''
  const isPlanet = cell.kind === 'planet'
  const isFeeField =
    cell.kind === 'empty' &&
    Boolean(cell.owner) &&
    cell.stack.length > 0
  const feeAllegiance: DefenseAllegiance | undefined = isFeeField
    ? tollTone(cell.owner, currentPlayerId)
    : undefined
  const tollClass = isFeeField
    ? `toll-${tollTone(cell.owner, currentPlayerId)}`
    : ''

  const isSun = cell.kind === 'sun'
  // Ganzes Nachziehpaket zeigen, damit der Stapel sichtbar schrumpft.
  const drawBacks = isSun ? cell.drawPile : []
  const visibleCards = isSun ? [...drawBacks, ...cell.stack] : cell.stack

  return (
    <button
      type="button"
      className={[
        'board-cell',
        `kind-${cell.kind}`,
        ownerClass,
        isFeeField ? 'has-defense' : '',
        feeAllegiance ? `defense-${feeAllegiance}` : '',
        onPath ? 'on-path' : '',
        waypoint ? 'has-waypoint' : '',
        isSelected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      aria-label={
        cell.label ??
        `${kindLabel[cell.kind] || 'Feld'} (${cell.x},${cell.y})`
      }
    >
      <div className="cell-glow" aria-hidden />
      <div className="cell-frame">
        <div className="cell-meta">
          <span className="cell-kind">
            {cell.label ?? kindLabel[cell.kind]}
          </span>
          {isFeeField && (
            <span
              className={`cell-toll ${tollClass}`}
              title={
                tollTone(cell.owner, currentPlayerId) === 'own'
                  ? 'Eigene Gebühr'
                  : tollTone(cell.owner, currentPlayerId) === 'enemy'
                    ? 'Gegnergebühr'
                    : 'Neutrale Gebühr'
              }
            >
              {cell.toll}¤
            </span>
          )}
        </div>

        {isPlanet && (
          <TensionMeter
            value={cell.tension}
            flash={demandFlash || limitFlash}
            flashKey={demandFlashKey + limitFlashKey * 1000}
            limitPulse={limitFlash}
          />
        )}

        <div className={`cell-stack ${isSun ? 'sun-deck' : ''}`}>
          {visibleCards.map((card, i) => {
            const inOpenStack = !isSun || i >= drawBacks.length
            const openIndex = isSun ? i - drawBacks.length : i
            const fromTop = cell.stack.length - openIndex
            const highlight =
              inOpenStack &&
              selectedCount > 0 &&
              fromTop <= selectedCount
            return (
              <PlayingCard
                key={card.id}
                card={inOpenStack ? card : { ...card, faceUp: false }}
                compact
                stacked={i > 0}
                stackIndex={i}
                highlight={highlight}
                defenseAllegiance={
                  card.suit === 'spades' ? feeAllegiance : undefined
                }
              />
            )
          })}
          {isSun && (
            <span
              className="sun-pile-count"
              title={`Nachziehstapel (${drawBacks.length + cell.stack.length})`}
            >
              {drawBacks.length + cell.stack.length}
            </span>
          )}
        </div>

        {waypoint != null && (
          <div className="waypoint-badge" title={`Wegpunkt ${waypoint}`}>
            {waypoint}
          </div>
        )}

        {pathCost != null && (
          <div className="path-cost">{pathCost}¤</div>
        )}
      </div>
    </button>
  )
}
