import type { MouseEvent } from 'react'
import type { CellState } from '../types'
import { PlayingCard } from './PlayingCard'
import './BoardCell.css'

const kindLabel: Record<CellState['kind'], string> = {
  empty: '',
  sun: 'Sonne',
  planet: 'Planet',
  storage: 'Speicher',
  base: 'Basis',
  asteroid: 'Asteroid',
}

export function BoardCell({
  cell,
  selectedCount,
  onPath,
  pathCost,
  onClick,
  onVpClick,
  onMouseEnter,
  onHarvest,
}: {
  cell: CellState
  selectedCount: number
  onPath: boolean
  pathCost: number | null
  onClick: () => void
  onVpClick: (e: MouseEvent) => void
  onMouseEnter: () => void
  onHarvest: () => void
}) {
  const isSelected = selectedCount !== 0
  const ownerClass =
    cell.owner && cell.owner !== 'neutral' ? `owner-${cell.owner}` : ''
  const defense = cell.stack[0]?.suit === 'spades'

  return (
    <button
      type="button"
      className={[
        'board-cell',
        `kind-${cell.kind}`,
        ownerClass,
        defense ? 'has-defense' : '',
        onPath ? 'on-path' : '',
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
          {defense && (
            <span className="cell-toll" title="Durchgangsgebühr">
              {cell.toll}¤
            </span>
          )}
        </div>

        <div className="cell-stack">
          {cell.stack.map((card, i) => {
            const fromTop = cell.stack.length - i
            const highlight =
              selectedCount > 0 && fromTop <= selectedCount
            return (
              <PlayingCard
                key={card.id}
                card={card}
                compact
                stacked={i > 0}
                highlight={highlight}
              />
            )
          })}
        </div>

        {cell.vpMarkers > 0 && (
          <button
            type="button"
            className={`vp-badge ${selectedCount === -1 ? 'active' : ''}`}
            onClick={onVpClick}
            title="Siegpunktmarker transportieren"
          >
            ◆ {cell.vpMarkers}
          </button>
        )}

        {pathCost != null && (
          <div className="path-cost">{pathCost}¤</div>
        )}

        {isSelected &&
          selectedCount > 0 &&
          cell.kind === 'planet' &&
          cell.stack.slice(-selectedCount).every((c) => c.suit === 'hearts') && (
            <button
              type="button"
              className="harvest-btn"
              onClick={(e) => {
                e.stopPropagation()
                onHarvest()
              }}
            >
              → SP
            </button>
          )}
      </div>
    </button>
  )
}
