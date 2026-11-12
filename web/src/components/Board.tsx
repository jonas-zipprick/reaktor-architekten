import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import type { FieldState, GameState, Suit } from '../types'
import { MARKET_EXP_TO_SPAWN, SUITS, suitName, suitSymbol } from '../types'
import { useGameStore } from '../state/gameStore'
import { checkMove, movableCard, type MoveCheck } from '../state/rules'
import { BoardCell } from './BoardCell'
import { PlayingCard } from './PlayingCard'
import './Board.css'

const ROW_LABELS = ['Rohstoffquellen', 'Fabriken & Infrastruktur', 'Märkte']

function isFactoryColumn(field: FieldState): boolean {
  return field.kind === 'factory'
}

function isStorageColumn(field: FieldState): boolean {
  return field.kind === 'storage'
}

/** Nachzieh- und Ablagestapel einer Kartenfarbe. */
function DeckPanel({ game, suit }: { game: GameState; suit: Suit }) {
  const deck = game.decks[suit]
  const top = deck.draw[deck.draw.length - 1]
  const discardTop = deck.discard[deck.discard.length - 1]
  return (
    <aside
      className="board-discard"
      title={`${suitName(suit)}: ${deck.draw.length} im Nachziehstapel, ${deck.discard.length} in der Ablage`}
    >
      <span className="board-discard-label">
        {suitSymbol(suit)} {suitName(suit)}
      </span>
      <div className="board-deck-piles">
        <div className="board-pile">
          <div className="board-discard-stack">
            {top ? <PlayingCard card={top} compact faceDown /> : null}
          </div>
          <span className="board-discard-count">{deck.draw.length}</span>
        </div>
        <div className="board-pile">
          <div className="board-discard-stack">
            {discardTop ? <PlayingCard card={discardTop} compact /> : null}
          </div>
          <span className="board-discard-count">{deck.discard.length}</span>
        </div>
      </div>
    </aside>
  )
}

export function Board({ game }: { game: GameState }) {
  const select = useGameStore((s) => s.select)
  const moveTo = useGameStore((s) => s.moveTo)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const endTurn = useGameStore((s) => s.endTurn)
  const moveAnim = useGameStore((s) => s.moveAnim)
  const auction = useGameStore((s) => s.auction)

  const rows = useMemo(() => {
    const byRow = new Map<number, FieldState[]>()
    for (const field of Object.values(game.fields)) {
      const list = byRow.get(field.row) ?? []
      list.push(field)
      byRow.set(field.row, list)
    }
    return [...byRow.entries()].sort((a, b) => a[0] - b[0])
  }, [game.fields])

  /** Legale Ziele der aktuellen Auswahl inkl. Gebühren und Einkommen. */
  const targets = useMemo(() => {
    const map = new Map<string, MoveCheck>()
    if (!game.selection) return map
    for (const id of Object.keys(game.fields)) {
      const check = checkMove(
        game,
        game.selection.fieldId,
        id,
        game.selection.count,
      )
      if (check.ok) map.set(id, check)
    }
    return map
  }, [game])

  const demandFlashIds = useMemo(
    () => new Set(game.demandRollIds),
    [game.demandRollIds],
  )
  const producedIds = useMemo(
    () => new Set(game.producedIds),
    [game.producedIds],
  )

  const onFieldClick = (field: FieldState, _e: MouseEvent) => {
    if (game.ended || moveAnim || auction) return

    if (game.selection) {
      // Erneuter Klick auf denselben Stapel: Teilstapelhöhe erhöhen.
      if (game.selection.fieldId === field.id) {
        select(field.id)
        return
      }
      if (targets.has(field.id)) {
        moveTo(field.id)
        return
      }
      // Kein legales Ziel: stattdessen diese Karte auswählen, sonst Grund zeigen.
      if (movableCard(game, field.id)) {
        select(field.id)
      } else {
        moveTo(field.id)
      }
      return
    }

    if (movableCard(game, field.id)) select(field.id)
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    if (game.selection) clearSelection()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'Escape') {
        if (!useGameStore.getState().game?.selection) return
        e.preventDefault()
        clearSelection()
        return
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        endTurn()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, endTurn])

  const viewportRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const fieldCount = Object.keys(game.fields).length

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const shell = shellRef.current
    if (!viewport || !shell) return

    const measure = () => {
      // Natürliche Größe ohne Transform messen (Layout bleibt unverändert).
      const sw = shell.offsetWidth
      const sh = shell.offsetHeight
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      if (sw <= 0 || sh <= 0 || vw <= 0 || vh <= 0) return
      const next = Math.min(vw / sw, vh / sh) * 0.99
      setScale(next)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [fieldCount])

  return (
    <div className="board-viewport" ref={viewportRef}>
      <div
        className="board-shell"
        ref={shellRef}
        onContextMenu={onContextMenu}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div className="board-grid">
          {rows.map(([row, fields]) => {
            const factories = fields.filter(isFactoryColumn)
            const storages = fields.filter(isStorageColumn)
            const split =
              factories.length > 0 && storages.length > 0
            const rest = split
              ? fields.filter(
                  (f) => !isFactoryColumn(f) && !isStorageColumn(f),
                )
              : fields

            const renderCell = (field: FieldState) => (
              <BoardCell
                key={field.id}
                field={field}
                selected={game.selection?.fieldId === field.id}
                selectedCount={
                  game.selection?.fieldId === field.id
                    ? game.selection.count
                    : 0
                }
                target={targets.get(field.id) ?? null}
                demandFlash={demandFlashIds.has(field.id)}
                demandFlashKey={game.demandRollSeq}
                limitFlash={game.planetLimitId === field.id}
                limitFlashKey={game.planetLimitSeq}
                produced={producedIds.has(field.id)}
                onClick={(e) => onFieldClick(field, e)}
              />
            )

            if (split) {
              return (
                <div key={row} className="board-row-split">
                  <div className="board-row-col">
                    <p className="board-row-label">Fabriken</p>
                    <div className="board-row">{factories.map(renderCell)}</div>
                  </div>
                  <div className="board-row-col">
                    <p className="board-row-label">Infrastruktur</p>
                    <div className="board-row">{storages.map(renderCell)}</div>
                  </div>
                  {rest.length > 0 && (
                    <div className="board-row">{rest.map(renderCell)}</div>
                  )}
                </div>
              )
            }

            const isMarketRow = fields.some((f) => f.kind === 'market')
            const exp = Math.max(
              0,
              Math.min(MARKET_EXP_TO_SPAWN, game.marketExp),
            )
            return (
              <div key={row}>
                <p className="board-row-label">{ROW_LABELS[row] ?? ''}</p>
                {isMarketRow && (
                  <div
                    className="exp-track"
                    title={`Expansion ${exp}/${MARKET_EXP_TO_SPAWN}: jedes Zugende +1, jeder Marktkollaps setzt auf 0.`}
                    role="meter"
                    aria-label={`Expansion ${exp} von ${MARKET_EXP_TO_SPAWN}`}
                    aria-valuemin={0}
                    aria-valuemax={MARKET_EXP_TO_SPAWN}
                    aria-valuenow={exp}
                  >
                    <span className="exp-track-label">Exp</span>
                    <div className="exp-track-rail">
                      <div className="exp-track-scale">
                        {Array.from(
                          { length: MARKET_EXP_TO_SPAWN + 1 },
                          (_, i) => (
                            <span
                              key={i}
                              className={[
                                'exp-track-tick',
                                i === 0 || i === MARKET_EXP_TO_SPAWN
                                  ? 'major'
                                  : '',
                                i === exp ? 'active' : '',
                                i < exp ? 'filled' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                left: `${(i / MARKET_EXP_TO_SPAWN) * 100}%`,
                              }}
                            >
                              <em>{i}</em>
                            </span>
                          ),
                        )}
                        <span
                          className="exp-track-stone"
                          style={{
                            left: `${(exp / MARKET_EXP_TO_SPAWN) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="exp-track-value">
                      {exp}/{MARKET_EXP_TO_SPAWN}
                    </span>
                  </div>
                )}
                <div className="board-row">{fields.map(renderCell)}</div>
              </div>
            )
          })}
        </div>

        <div className="board-discards" aria-label="Nachzieh- und Ablagestapel">
          {SUITS.map((suit) => (
            <DeckPanel key={suit} game={game} suit={suit} />
          ))}
        </div>
      </div>
    </div>
  )
}
