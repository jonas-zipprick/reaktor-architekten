import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import type { FieldState, GameState, Suit } from '../types'
import { isSeedBed, SUITS, suitName, suitSymbol } from '../types'
import { useGameStore } from '../state/gameStore'
import { ROW } from '../data/scenarios'
import {
  buyableInfraLabel,
  buyableInfraShort,
  checkMove,
  hasOutputStack,
  movableCard,
  nextBuyInfraPrice,
  type BuyableInfra,
  type MoveCheck,
  type StackLane,
} from '../state/rules'
import { BoardCell } from './BoardCell'
import { PlayingCard } from './PlayingCard'
import './Board.css'

const ROW_LABELS = ['Felder', 'Küchen & Infrastruktur', 'Marktstände']

function isFactoryColumn(field: FieldState): boolean {
  return field.kind === 'factory'
}

function isStorageColumn(field: FieldState): boolean {
  return field.kind === 'storage' || field.kind === 'victory'
}

/** Saatstand / Getreide — ohne Regen (eigener Bereich). */
function isFeldColumn(field: FieldState): boolean {
  return field.kind === 'source' && field.suit !== 'energy'
}

function isRegenColumn(field: FieldState): boolean {
  return field.kind === 'source' && field.suit === 'energy'
}

/** Nachzieh- und Ablagestapel einer Kartenfarbe. */
function DeckPanel({ game, suit }: { game: GameState; suit: Suit }) {
  const deck = game.decks[suit]
  const top = deck.draw[deck.draw.length - 1]
  const discardTop = deck.discard[deck.discard.length - 1]
  return (
    <aside
      className={`board-discard suit-${suit}`}
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

function BuyInfraButton({
  item,
  game,
  disabled,
  onBuy,
}: {
  item: BuyableInfra
  game: GameState
  disabled: boolean
  onBuy: (item: BuyableInfra) => void
}) {
  const current = game.players[game.currentPlayerIndex]!
  const price = nextBuyInfraPrice(game, item, current.id)
  const canBuy = !disabled && price >= 20 && current.money >= price
  const label = buyableInfraLabel(item)
  return (
    <button
      type="button"
      className="buy-beet-btn"
      disabled={!canBuy}
      title={
        canBuy
          ? `${label} für ${current.name}: ${price}¤`
          : `${label} für ${current.name}: ${price}¤ (Bargeld ${current.money}¤)`
      }
      aria-label={`${label} für ${current.name} kaufen, ${price} Geld`}
      onClick={(e) => {
        e.stopPropagation()
        onBuy(item)
      }}
    >
      <span className="buy-beet-plus" aria-hidden>
        +
      </span>
      <span className="buy-beet-name">{buyableInfraShort(item)}</span>
      <span className="buy-beet-price">{price}¤</span>
    </button>
  )
}

export function Board({ game }: { game: GameState }) {
  const select = useGameStore((s) => s.select)
  const moveTo = useGameStore((s) => s.moveTo)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const endTurn = useGameStore((s) => s.endTurn)
  const buyInfra = useGameStore((s) => s.buyInfra)
  const moveAnim = useGameStore((s) => s.moveAnim)
  const auction = useGameStore((s) => s.auction)
  const buyLocked = game.ended || !!moveAnim || !!auction

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
    const fromOpts = { stackIndex: game.selection.stackIndex ?? 0 }
    for (const id of Object.keys(game.fields)) {
      const field = game.fields[id]!
      const inputCount =
        field.kind === 'market' || field.kind === 'victory'
          ? (field.inputs?.length ?? (field.kind === 'victory' ? 3 : 1))
          : 1
      for (let toIdx = 0; toIdx < inputCount; toIdx++) {
        const check = checkMove(
          game,
          game.selection.fieldId,
          id,
          game.selection.count,
          game.selection.lane,
          { ...fromOpts, toStackIndex: toIdx },
        )
        if (check.ok) {
          map.set(id, check)
          break
        }
      }
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

  const onFieldClick = (
    field: FieldState,
    _e: MouseEvent,
    lane?: StackLane,
    stackIndex = 0,
  ) => {
    if (game.ended || moveAnim || auction) return

    const clickLane: StackLane | undefined = hasOutputStack(field)
      ? (lane ?? 'output')
      : undefined
    const idx = Math.max(0, stackIndex)

    if (game.selection) {
      const sameField = game.selection.fieldId === field.id
      const sameLane =
        (game.selection.lane ?? 'output') === (clickLane ?? 'output')
      const sameStack = (game.selection.stackIndex ?? 0) === idx
      // Erneuter Klick auf denselben Stapel: Teilstapelhöhe erhöhen.
      if (sameField && sameLane && sameStack) {
        select(field.id, clickLane, idx)
        return
      }
      // Siegpunkte: andere Spalte → Umsortieren wenn legal, sonst Auswahl wechseln.
      if (sameField && field.kind === 'victory' && !sameStack) {
        const reorder = checkMove(
          game,
          field.id,
          field.id,
          game.selection.count,
          undefined,
          {
            stackIndex: game.selection.stackIndex ?? 0,
            toStackIndex: idx,
          },
        )
        if (reorder.ok) {
          moveTo(field.id, idx)
          return
        }
        select(field.id, undefined, idx)
        return
      }
      // Andere Spur / anderer Stapel desselben Feldes: Auswahl wechseln.
      if (sameField && (clickLane || field.kind === 'market')) {
        select(field.id, clickLane, idx)
        return
      }
      if (targets.has(field.id)) {
        moveTo(
          field.id,
          field.kind === 'market' || field.kind === 'victory' ? idx : 0,
        )
        return
      }
      // Kein legales Ziel: stattdessen diese Karte auswählen, sonst Grund zeigen.
      if (movableCard(game, field.id, clickLane, idx)) {
        select(field.id, clickLane, idx)
      } else {
        moveTo(
          field.id,
          field.kind === 'market' || field.kind === 'victory' ? idx : 0,
        )
      }
      return
    }

    if (movableCard(game, field.id, clickLane, idx)) {
      select(field.id, clickLane, idx)
    }
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    if (game.selection) clearSelection()
  }

  // Leertaste: Mindestens 1 s Abstand, sonst springt man versehentlich viele Züge weiter.
  const lastSpaceEndTurnAt = useRef(0)

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
        if (e.repeat) return
        const now = performance.now()
        if (now - lastSpaceEndTurnAt.current < 1000) return
        lastSpaceEndTurnAt.current = now
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
            const midRow = row === ROW.factory
            const rest = midRow
              ? fields.filter(
                  (f) => !isFactoryColumn(f) && !isStorageColumn(f),
                )
              : fields

            const renderCell = (
              field: FieldState,
              extraBuys: BuyableInfra[] = [],
            ) => {
              const cell = (
                <BoardCell
                  field={field}
                  selected={game.selection?.fieldId === field.id}
                  selectedLane={
                    game.selection?.fieldId === field.id
                      ? (game.selection.lane ?? 'output')
                      : null
                  }
                  selectedStackIndex={
                    game.selection?.fieldId === field.id
                      ? (game.selection.stackIndex ?? 0)
                      : 0
                  }
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
                  onClick={(e, lane, stackIndex) =>
                    onFieldClick(field, e, lane, stackIndex)
                  }
                />
              )
              if (extraBuys.length === 0) {
                return <div key={field.id}>{cell}</div>
              }
              return (
                <div key={field.id} className="board-cell-with-buy">
                  {cell}
                  <div className="buy-btn-stack">
                    {extraBuys.map((item) => (
                      <BuyInfraButton
                        key={item}
                        item={item}
                        game={game}
                        disabled={buyLocked}
                        onBuy={buyInfra}
                      />
                    ))}
                  </div>
                </div>
              )
            }

            if (midRow) {
              return (
                <div key={row} className="board-row-split">
                  <div className="board-row-col">
                    <p className="board-row-label">Küchen</p>
                    <div className="board-row">
                      {factories.map((field, i) =>
                        renderCell(
                          field,
                          i === factories.length - 1
                            ? ['mehlmuehle', 'konfituerenkueche']
                            : [],
                        ),
                      )}
                      {factories.length === 0 && (
                        <div className="buy-btn-stack">
                          <BuyInfraButton
                            item="mehlmuehle"
                            game={game}
                            disabled={buyLocked}
                            onBuy={buyInfra}
                          />
                          <BuyInfraButton
                            item="konfituerenkueche"
                            game={game}
                            disabled={buyLocked}
                            onBuy={buyInfra}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="board-row-col">
                    <p className="board-row-label">Infrastruktur</p>
                    <div className="board-row">
                      {(() => {
                        const currentId =
                          game.players[game.currentPlayerIndex]!.id
                        const sheds = storages.filter((f) => f.kind === 'storage')
                        const victory = storages.filter((f) => f.kind === 'victory')
                        // +Schuppen nur am eigenen letzten Schuppen — Preis ist
                        // spielerspezifisch (sonst wirkt fremder Kauf wie teurer).
                        const mine = sheds.filter((f) => f.owner === currentId)
                        const buyAtId = mine[mine.length - 1]?.id
                        return (
                          <>
                            {sheds.map((field) =>
                              renderCell(
                                field,
                                field.id === buyAtId ? ['schuppen'] : [],
                              ),
                            )}
                            {mine.length === 0 && (
                              <BuyInfraButton
                                item="schuppen"
                                game={game}
                                disabled={buyLocked}
                                onBuy={buyInfra}
                              />
                            )}
                            {victory.map((field) => renderCell(field))}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                  {rest.length > 0 && (
                    <div className="board-row">{rest.map((f) => renderCell(f))}</div>
                  )}
                </div>
              )
            }

            if (row === ROW.source) {
              const felder = fields.filter(isFeldColumn)
              const regen = fields.filter(isRegenColumn)
              const seedBeds = felder.filter((f) => isSeedBed(f))
              const grains = felder.filter((f) => f.suit === 'spades')
              return (
                <div key={row} className="board-row-split">
                  <div className="board-row-col">
                    <p className="board-row-label">Felder</p>
                    <div className="board-row">
                      {seedBeds.map((field, i) =>
                        renderCell(
                          field,
                          i === seedBeds.length - 1 ? ['getreidefeld'] : [],
                        ),
                      )}
                      {grains.map((field) => renderCell(field))}
                      {seedBeds.length === 0 && (
                        <BuyInfraButton
                          item="getreidefeld"
                          game={game}
                          disabled={buyLocked}
                          onBuy={buyInfra}
                        />
                      )}
                    </div>
                  </div>
                  <div className="board-row-col">
                    <p className="board-row-label">Regen</p>
                    <div className="board-row">
                      {regen.map((field) => renderCell(field))}
                    </div>
                  </div>
                </div>
              )
            }

            const marketFields = fields
            return (
              <div key={row}>
                <p className="board-row-label">{ROW_LABELS[row] ?? ''}</p>
                <div className="board-row">
                  {row === ROW.market &&
                    marketFields.map((field, i) =>
                      renderCell(
                        field,
                        i === marketFields.length - 1
                          ? ['mehlstand', 'konfituerenstand']
                          : [],
                      ),
                    )}
                  {row !== ROW.market && fields.map((f) => renderCell(f))}
                  {row === ROW.market && marketFields.length === 0 && (
                    <div className="buy-btn-stack">
                      <BuyInfraButton
                        item="mehlstand"
                        game={game}
                        disabled={buyLocked}
                        onBuy={buyInfra}
                      />
                      <BuyInfraButton
                        item="konfituerenstand"
                        game={game}
                        disabled={buyLocked}
                        onBuy={buyInfra}
                      />
                    </div>
                  )}
                </div>
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
