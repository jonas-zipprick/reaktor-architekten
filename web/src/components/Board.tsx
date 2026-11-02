import { useMemo, type MouseEvent } from 'react'
import type { CellState, GameState } from '../types'
import { keyOf } from '../types'
import { useGameStore } from '../state/gameStore'
import { canSelectVp, selectableCounts } from '../state/rules'
import { BoardCell } from './BoardCell'
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
  const selectVp = useGameStore((s) => s.selectVp)
  const moveTo = useGameStore((s) => s.moveTo)
  const hover = useGameStore((s) => s.hover)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const harvestVp = useGameStore((s) => s.harvestVp)

  const { minX, maxX, minY, maxY } = useMemo(
    () => boardBounds(game.cells),
    [game.cells],
  )

  const pathSet = useMemo(() => {
    const set = new Set<string>()
    for (const p of game.pathPreview ?? []) set.add(keyOf(p.x, p.y))
    return set
  }, [game.pathPreview])

  const cols = maxX - minX + 1
  const rows = maxY - minY + 1

  const onCellClick = (cell: CellState) => {
    if (game.ended) return

    // If something selected, try move
    if (game.selection) {
      if (
        game.selection.type === 'stack' &&
        game.selection.x === cell.x &&
        game.selection.y === cell.y
      ) {
        // Cycle count or clear
        const counts = selectableCounts(game, cell.x, cell.y)
        const idx = counts.indexOf(game.selection.count)
        if (idx >= 0 && idx < counts.length - 1) {
          selectStack(cell.x, cell.y, counts[idx + 1])
        } else {
          clearSelection()
        }
        return
      }

      // Planet energy harvest: selecting on planet means create VP
      if (
        game.selection.type === 'stack' &&
        game.cells[keyOf(game.selection.x, game.selection.y)]?.kind ===
          'planet'
      ) {
        // Clicking elsewhere cancels; harvest via panel button
        moveTo({ x: cell.x, y: cell.y })
        return
      }

      moveTo({ x: cell.x, y: cell.y })
      return
    }

    // Fresh selection
    if (canSelectVp(game, cell.x, cell.y) && cell.stack.every((c) => c.suit === 'clubs' || !c)) {
      // Prefer cards if energy selectable
    }

    const counts = selectableCounts(game, cell.x, cell.y)
    if (counts.length) {
      // On planet: selecting energy prepares harvest (confirm in panel)
      selectStack(cell.x, cell.y, counts[0])
      return
    }
    if (canSelectVp(game, cell.x, cell.y)) {
      selectVp(cell.x, cell.y)
    }
  }

  const onVpBadgeClick = (cell: CellState, e: MouseEvent) => {
    e.stopPropagation()
    if (game.selection?.type === 'vp' && game.selection.x === cell.x) {
      clearSelection()
      return
    }
    if (canSelectVp(game, cell.x, cell.y)) selectVp(cell.x, cell.y)
  }

  return (
    <div className="board-shell">
      <div
        className="board-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, var(--cell-size))`,
          gridTemplateRows: `repeat(${rows}, calc(var(--cell-size) * 1.28))`,
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
                : game.selection?.type === 'vp' &&
                    game.selection.x === x &&
                    game.selection.y === y
                  ? -1
                  : 0

            return (
              <BoardCell
                key={`${x},${y}`}
                cell={cell}
                selectedCount={selected}
                onPath={pathSet.has(keyOf(x, y))}
                pathCost={
                  game.pathPreview?.length &&
                  game.pathPreview[game.pathPreview.length - 1]?.x === x &&
                  game.pathPreview[game.pathPreview.length - 1]?.y === y
                    ? game.pathCost
                    : null
                }
                onClick={() => onCellClick(cell)}
                onVpClick={(e) => onVpBadgeClick(cell, e)}
                onMouseEnter={() => {
                  if (game.selection) hover({ x, y })
                }}
                onHarvest={() => {
                  if (
                    game.selection?.type === 'stack' &&
                    game.selection.x === x &&
                    game.selection.y === y &&
                    cell.kind === 'planet'
                  ) {
                    harvestVp(x, y, game.selection.count)
                  }
                }}
              />
            )
          })
        })}
      </div>
    </div>
  )
}
