import { useEffect, useMemo, type MouseEvent } from 'react'
import type { CellState, GameState } from '../types'
import { keyOf } from '../types'
import { useGameStore } from '../state/gameStore'
import {
  isMoveTarget,
  isVacantEmpty,
  selectableCounts,
} from '../state/rules'
import { BoardCell } from './BoardCell'
import { PlayingCard } from './PlayingCard'
import './Board.css'

function boardBounds(cells: Record<string, CellState>) {
  const xs = Object.values(cells).map((c) => c.x)
  const ys = Object.values(cells).map((c) => c.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

export function Board({ game }: { game: GameState }) {
  const selectStack = useGameStore((s) => s.selectStack)
  const moveTo = useGameStore((s) => s.moveTo)
  const setWaypoint = useGameStore((s) => s.setWaypoint)
  const hover = useGameStore((s) => s.hover)
  const clearSelection = useGameStore((s) => s.clearSelection)

  const { minX, maxX, minY, maxY } = useMemo(
    () => boardBounds(game.cells),
    [game.cells],
  )

  const pathSet = useMemo(() => {
    const set = new Set<string>()
    for (const p of game.pathPreview ?? []) set.add(keyOf(p.x, p.y))
    return set
  }, [game.pathPreview])

  const waypointIndex = useMemo(() => {
    const map = new Map<string, number>()
    game.waypoints.forEach((w, i) => map.set(keyOf(w.x, w.y), i + 1))
    return map
  }, [game.waypoints])

  const cols = maxX - minX + 1
  const rows = maxY - minY + 1

  const onCellClick = (cell: CellState, e: MouseEvent) => {
    if (game.ended) return

    if (game.selection) {
      if (
        game.selection.type === 'stack' &&
        game.selection.x === cell.x &&
        game.selection.y === cell.y
      ) {
        const counts = selectableCounts(game, cell.x, cell.y)
        const idx = counts.indexOf(game.selection.count)
        if (idx >= 0 && idx < counts.length - 1) {
          selectStack(cell.x, cell.y, counts[idx + 1])
        } else if (counts.length > 1) {
          selectStack(cell.x, cell.y, counts[0])
        }
        return
      }

      // Shift+click: Wegpunkt auf freiem leerem Feld (auch für Verteidigung).
      if (e.shiftKey) {
        if (isVacantEmpty(cell)) {
          setWaypoint({ x: cell.x, y: cell.y })
        }
        return
      }

      const asMove = isMoveTarget(game, { x: cell.x, y: cell.y })
      // Ohne Shift: leere Felder, die kein Ziel sind, als Wegpunkt nutzen (z. B. Energie).
      if (isVacantEmpty(cell) && !asMove) {
        setWaypoint({ x: cell.x, y: cell.y })
        return
      }

      moveTo({ x: cell.x, y: cell.y })
      return
    }

    const counts = selectableCounts(game, cell.x, cell.y)
    if (counts.length) {
      selectStack(cell.x, cell.y, counts[0])
    }
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    if (game.selection) clearSelection()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!useGameStore.getState().game?.selection) return
      e.preventDefault()
      clearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection])

  return (
    <div className="board-shell" onContextMenu={onContextMenu}>
      <div
        className="board-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, var(--cell-size))`,
          gridTemplateRows: `repeat(${rows}, var(--cell-height))`,
        }}
        onMouseLeave={() => hover(null)}
      >
        {Array.from({ length: rows }, (_, row) => {
          const y = minY + row
          return Array.from({ length: cols }, (_, col) => {
            const x = minX + col
            const cell = game.cells[keyOf(x, y)]
            if (!cell) {
              return (
                <div
                  key={`${x},${y}`}
                  className="board-cell missing"
                  aria-hidden
                />
              )
            }

            const selected =
              game.selection?.type === 'stack' &&
              game.selection.x === x &&
              game.selection.y === y
                ? game.selection.count
                : 0

            return (
              <BoardCell
                key={`${x},${y}`}
                cell={cell}
                selectedCount={selected}
                currentPlayerId={game.players[game.currentPlayerIndex].id}
                demandFlash={game.demandRollSeq > 0}
                demandFlashKey={game.demandRollSeq}
                limitFlash={game.planetLimitSeq > 0}
                limitFlashKey={game.planetLimitSeq}
                onPath={pathSet.has(keyOf(x, y))}
                waypoint={waypointIndex.get(keyOf(x, y)) ?? null}
                pathCost={
                  game.pathPreview?.length &&
                  game.pathPreview[game.pathPreview.length - 1]?.x === x &&
                  game.pathPreview[game.pathPreview.length - 1]?.y === y
                    ? game.pathCost
                    : null
                }
                onClick={(e) => onCellClick(cell, e)}
                onMouseEnter={() => {
                  if (game.selection) hover({ x, y })
                }}
              />
            )
          })
        })}
      </div>

      <aside
        className="board-discard"
        title={`Energie-Ablage (${game.energyDiscard.length})`}
        aria-label={`Energie-Ablage mit ${game.energyDiscard.length} Karten`}
      >
        <span className="board-discard-label">Ablage</span>
        <div className="board-discard-stack sun-deck">
          {game.energyDiscard.map((card, i) => (
            <PlayingCard
              key={card.id}
              card={{ ...card, faceUp: true }}
              compact
              stacked={i > 0}
              stackIndex={i}
            />
          ))}
        </div>
        <span className="board-discard-count">{game.energyDiscard.length}</span>
      </aside>
    </div>
  )
}
