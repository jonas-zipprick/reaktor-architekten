import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import type { FieldState, GameState, PlayerId, Suit } from '../types'
import {
  isOwnerOnlyField,
  isRegen,
  isSeedBed,
  isWaterTrade,
  MARKET_PRICES,
  marketFieldId,
  SUITS,
  suitName,
  suitSymbol,
} from '../types'
import { PLAYER_META } from '../data/scenarios'
import { useGameStore } from '../state/gameStore'
import {
  checkMove,
  hasOutputStack,
  movableCard,
  type MoveCheck,
  type StackLane,
} from '../state/rules'
import {
  BoardCell,
  DemandMeter,
  MarketStallMeter,
  MarketZeroMeter,
} from './BoardCell'
import { PlayingCard } from './PlayingCard'
import './Board.css'

/** Nur Eigentümer: Regen, Beet, Schuppen, Ernte. */
function isPrivateField(field: FieldState): boolean {
  return isOwnerOnlyField(field)
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

export function Board({ game }: { game: GameState }) {
  const select = useGameStore((s) => s.select)
  const moveTo = useGameStore((s) => s.moveTo)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const endTurn = useGameStore((s) => s.endTurn)
  const moveAnim = useGameStore((s) => s.moveAnim)
  const auction = useGameStore((s) => s.auction)

  const { communal, byPlayer } = useMemo(() => {
    const all = Object.values(game.fields)
    const communal = all.filter((f) => !isPrivateField(f))
    const byPlayer = new Map<PlayerId, FieldState[]>()
    for (const p of game.players) byPlayer.set(p.id, [])
    for (const f of all) {
      if (!isPrivateField(f)) continue
      const owner = f.owner
      if (!owner || owner === 'state') continue
      const list = byPlayer.get(owner)
      if (list) list.push(f)
    }
    for (const list of byPlayer.values()) {
      list.sort((a, b) => {
        const rank = (f: FieldState) =>
          isRegen(f) ? 0 : f.kind === 'factory' ? 1 : f.kind === 'storage' ? 2 : 3
        const d = rank(a) - rank(b)
        return d !== 0 ? d : a.id.localeCompare(b.id)
      })
    }
    return { communal, byPlayer }
  }, [game.fields, game.players])

  const seedBeds = communal.filter((f) => isSeedBed(f))
  const waterTrades = communal.filter((f) => isWaterTrade(f))
  const markets = communal.filter((f) => f.kind === 'market')
  const communalRest = communal.filter(
    (f) => !isSeedBed(f) && !isWaterTrade(f) && f.kind !== 'market',
  )

  /** Legale Ziele der aktuellen Auswahl inkl. Gebühren und Einkommen. */
  const targets = useMemo(() => {
    const map = new Map<string, MoveCheck>()
    if (!game.selection) return map
    const fromOpts = { stackIndex: game.selection.stackIndex ?? 0 }
    for (const id of Object.keys(game.fields)) {
      const check = checkMove(
        game,
        game.selection.fieldId,
        id,
        game.selection.count,
        game.selection.lane,
        fromOpts,
      )
      if (check.ok) map.set(id, check)
    }
    return map
  }, [game])

  const demandFlashIds = useMemo(
    () => new Set(game.demandRollIds),
    [game.demandRollIds],
  )
  const marketFlash = useMemo(
    () =>
      game.demandRollIds.some(
        (id) => game.fields[id]?.kind === 'market' || id.startsWith('markt-'),
      ) || game.planetLimitId?.startsWith('markt-') === true,
    [game.demandRollIds, game.fields, game.planetLimitId],
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
      if (sameField && sameLane && sameStack) {
        select(field.id, clickLane, idx)
        return
      }
      if (sameField && (clickLane || field.kind === 'market')) {
        select(field.id, clickLane, idx)
        return
      }
      if (targets.has(field.id)) {
        moveTo(field.id, 0)
        return
      }
      if (movableCard(game, field.id, clickLane, idx)) {
        select(field.id, clickLane, idx)
      } else {
        moveTo(field.id, 0)
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

  const renderCell = (field: FieldState) => (
    <div key={field.id}>
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
          game.selection?.fieldId === field.id ? game.selection.count : 0
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
    </div>
  )

  return (
    <div className="board-viewport" ref={viewportRef}>
      <div
        className="board-shell"
        ref={shellRef}
        onContextMenu={onContextMenu}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div className="board-grid">
          <section className="board-zone board-zone-communal">
            <p className="board-zone-label">Gemeinschaft</p>
            <div className="board-row-split">
              <div className="board-row-col">
                <p className="board-row-label">Saatstand</p>
                <div className="board-row">
                  {seedBeds.map((field) => renderCell(field))}
                </div>
              </div>
              {waterTrades.length > 0 && (
                <div className="board-row-col">
                  <p className="board-row-label">Wasserhandel</p>
                  <div className="board-row">
                    {waterTrades.map((field) => renderCell(field))}
                  </div>
                </div>
              )}
              {markets.length > 0 && (
                <div className="board-row-col board-market-col">
                  <p className="board-row-label">Markt</p>
                  <div className="board-market-stalls">
                    <div className="board-market-zero">
                      <MarketZeroMeter
                        value={game.marketDemand}
                        flash={marketFlash}
                        flashKey={
                          game.demandRollSeq + game.planetLimitSeq * 1000
                        }
                        limitPulse={
                          game.planetLimitId?.startsWith('markt-') === true
                        }
                      />
                    </div>
                    {MARKET_PRICES.map((price) => {
                      const field = game.fields[marketFieldId(price)]
                      return (
                        <div key={price} className="board-market-stall">
                          <MarketStallMeter
                            price={price}
                            value={game.marketDemand}
                            flash={marketFlash}
                            flashKey={
                              game.demandRollSeq + game.planetLimitSeq * 1000
                            }
                            limitPulse={
                              game.planetLimitId?.startsWith('markt-') === true
                            }
                          />
                          {field ? renderCell(field) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {communalRest.length > 0 && (
                <div className="board-row-col">
                  <div className="board-row">
                    {communalRest.map((field) => renderCell(field))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="board-zone board-zone-private">
            <p className="board-zone-label">Privat</p>
            <div className="board-player-groups">
              {game.players.map((player) => {
                const fields = byPlayer.get(player.id) ?? []
                const rains = fields.filter((f) => isRegen(f))
                const beets = fields.filter((f) => f.kind === 'factory')
                const storages = fields.filter((f) => f.kind === 'storage')
                const harvest = fields.filter((f) => f.kind === 'victory')
                const meta = PLAYER_META[player.id]
                return (
                  <div
                    key={player.id}
                    className={`board-player-group owner-${player.id}`}
                  >
                    <p className="board-player-label">
                      <i style={{ background: meta.color }} aria-hidden />
                      {player.name}
                    </p>
                    <div className="board-player-stack">
                      <div className="board-row">
                        {rains.map((field) => renderCell(field))}
                        {beets.map((field) => renderCell(field))}
                        {storages.map((field) => renderCell(field))}
                      </div>
                      <div className="board-row board-player-harvest">
                        {harvest.map((field) => renderCell(field))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
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
