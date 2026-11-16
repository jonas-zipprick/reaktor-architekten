import { useEffect, useState } from 'react'
import type { GameState, PlayerId } from '../types'
import { victoryColumnCount } from '../types'
import { useGameStore } from '../state/gameStore'
import {
  checkMove,
  completedVictoryColumns,
  describeCard,
  moneyVictoryScore,
  playerHarvestScore,
  playerVictoryScore,
  totalWealth,
} from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './SidePanel.css'

const COLLAPSE_KEY = 'ernte-side-collapsed'

export function SidePanel({ game }: { game: GameState }) {
  const undo = useGameStore((s) => s.undo)
  const viewIndex = useGameStore((s) => s.viewIndex)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const endTurn = useGameStore((s) => s.endTurn)
  const gift = useGameStore((s) => s.gift)
  const backToMenu = useGameStore((s) => s.backToMenu)
  const goMonteCarlo = useGameStore((s) => s.goMonteCarlo)
  const restart = useGameStore((s) => s.restart)
  const moveAnim = useGameStore((s) => s.moveAnim)
  const auction = useGameStore((s) => s.auction)

  const [giftTo, setGiftTo] = useState<PlayerId | ''>('')
  const [giftAmount, setGiftAmount] = useState(1)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const current = game.players[game.currentPlayerIndex]!
  const busy = game.ended || Boolean(moveAnim) || Boolean(auction)

  const selectedField = game.selection
    ? game.fields[game.selection.fieldId]
    : null
  const selectedCount = game.selection?.count ?? 0
  const selectedStackIndex = game.selection?.stackIndex ?? 0
  const selectedStack =
    selectedField?.kind === 'market'
      ? (selectedField.inputs?.[selectedStackIndex] ?? selectedField.stack)
      : selectedField?.stack
  const selectedCards =
    selectedStack && selectedCount > 0
      ? selectedStack.slice(selectedStack.length - selectedCount)
      : []
  const selectedCard = selectedCards[selectedCards.length - 1] ?? null
  const targetCount = game.selection
    ? Object.keys(game.fields).filter(
        (id) =>
          checkMove(
            game,
            game.selection!.fieldId,
            id,
            game.selection!.count,
          ).ok,
      ).length
    : 0

  const others = game.players.filter((p) => p.id !== current.id)
  const giftTarget = others.some((p) => p.id === giftTo)
    ? (giftTo as PlayerId)
    : others[0]?.id

  return (
    <aside className={`side-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="side-toolbar">
        <button
          type="button"
          className="ghost-btn side-collapse-btn"
          aria-expanded={!collapsed}
          aria-controls="side-panel-details"
          title={collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '«' : '»'}
          <span className="side-collapse-label">
            {collapsed ? 'Mehr' : 'Weniger'}
          </span>
        </button>
      </div>

      {collapsed && (
        <div className="side-essentials">
          <div
            className="side-money"
            title={
              current.bankClaims > 0
                ? `${current.money}T Bargeld + ${current.bankClaims} Bankforderungen`
                : `${current.money}T Bargeld`
            }
          >
            <span className="side-money-name">
              <i style={{ background: current.color }} />
              {current.name}
            </span>
            <strong className="side-money-value">{current.money}T</strong>
          </div>

          <button
            type="button"
            className="primary-btn side-end-turn"
            disabled={busy}
            onClick={() => endTurn()}
          >
            Karten ziehen und Produzieren
          </button>
        </div>
      )}

      <div
        id="side-panel-details"
        className="side-details"
        hidden={collapsed}
        inert={collapsed || undefined}
      >
        <header className="side-header">
          <div>
            <p className="eyebrow">Runde {game.turn}</p>
            <h2>
              <span
                className="player-dot"
                style={{ background: current.color }}
              />
              {current.name}
            </h2>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="ghost-btn"
              title={`Neu starten (aktueller Seed ${game.rngSeed})`}
              onClick={() => restart()}
            >
              Neu
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => goMonteCarlo()}
            >
              Monte Carlo
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => backToMenu()}
            >
              Menü
            </button>
          </div>
        </header>

        <section className={`balances ${game.players.length > 3 ? 'many' : ''}`}>
          {game.players.map((p) => {
            const active = p.id === current.id
            return (
              <div
                key={p.id}
                className={`balance-card ${active ? 'active' : ''}`}
                title={
                  p.bankClaims > 0
                    ? `${p.money}T Bargeld + ${p.bankClaims} Bankforderungen`
                    : `${p.money}T Bargeld`
                }
              >
                <span className="balance-name">
                  <i style={{ background: p.color }} />
                  {p.name}
                </span>
                <strong className="balance-money">{p.money}T</strong>
                <em>{totalWealth(p)} Ges.</em>
              </div>
            )
          })}
        </section>

        <section className="stat-grid">
          <div
            className="stat"
            title="Fertige Erntefelder (volle Folge 7→2) — Spielende bei Zugende mit allen drei"
          >
            <span>Ernte</span>
            <strong>
              {completedVictoryColumns(game, current.id)}
              <em> / {victoryColumnCount(game.players.length)}</em>
            </strong>
          </div>
          <div
            className="stat"
            title={`Ernte ${playerHarvestScore(game, current.id)} SP (Vielfalt) + Geld ${moneyVictoryScore(current.money)} SP (je angefangene 10T)`}
          >
            <span>SP</span>
            <strong>{playerVictoryScore(game, current.id)}</strong>
          </div>
          <div className="stat bank-stat">
            <span>Bank</span>
            <strong>{game.bank}T</strong>
          </div>
        </section>

        <section className="action-box">
          <h3>Aktion</h3>
          {!selectedField && (
            <p className="hint">
              Stapel anklicken, ggf. mehrfach für größere absteigende Auswahl,
              dann das Ziel. Bewegungen kosten keine Aktion — nur Abheben von
              fremden oder staatlichen Lagern kostet.
            </p>
          )}

          {game.actionError && (
            <p className="action-error">{game.actionError}</p>
          )}

          {selectedField && selectedCard && (
            <div className="sel-card">
              <div className="sel-cards-row">
                {selectedCards.map((c) => (
                  <PlayingCard key={c.id} card={c} compact />
                ))}
                <p>
                  {selectedCount > 1
                    ? `${selectedCount} Karten von ${selectedField.label}`
                    : `${describeCard(selectedCard)} von ${selectedField.label}`}
                </p>
              </div>
              <p className="hint">
                {selectedCount > 1
                  ? 'Erneut auf den Stapel klicken ändert die Anzahl. '
                  : 'Erneut auf den Stapel klicken wählt mehr Karten. '}
                {targetCount > 0
                  ? `${targetCount} mögliche${targetCount === 1 ? 's Ziel' : ' Ziele'} markiert.`
                  : 'Kein Feld nimmt diese Auswahl gerade an.'}
              </p>
            <button
              type="button"
              className="ghost-btn"
              onClick={clearSelection}
            >
              Abbrechen
            </button>
          </div>
          )}

          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => endTurn()}
          >
            Karten ziehen und Produzieren
            <span className="btn-sub">(Leertaste · beendet den Zug)</span>
          </button>

          <div className="action-row">
            <button
              type="button"
              className="ghost-btn"
              onClick={undo}
              disabled={viewIndex <= 0 || Boolean(moveAnim) || Boolean(auction)}
              title="Einen aufgezeichneten Schritt zurück"
            >
              Rückgängig
            </button>
          </div>
        </section>

        {game.players.length > 1 &&
          !game.ended &&
          others.length > 0 &&
          giftTarget && (
            <section className="market-box">
              <h3>Markt</h3>
              <div className="market-row">
                <select
                  aria-label="Empfänger"
                  value={giftTarget}
                  disabled={busy}
                  onChange={(e) => setGiftTo(e.target.value as PlayerId)}
                >
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  aria-label="Betrag"
                  min={1}
                  max={Math.max(1, current.money)}
                  value={giftAmount}
                  disabled={busy}
                  onChange={(e) =>
                    setGiftAmount(
                      Math.max(1, Math.floor(Number(e.target.value)) || 1),
                    )
                  }
                />
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy || current.money < giftAmount}
                  onClick={() => gift(giftTarget, giftAmount)}
                >
                  Geld schenken
                </button>
              </div>
            </section>
          )}

        {game.ended && game.winnerText && (
          <section className="end-box">
            <h3>Spielende</h3>
            <p>{game.winnerText}</p>
          </section>
        )}

        <section className="log-box">
          <h3>Protokoll</h3>
          <ul>
            {game.log.map((e) => (
              <li key={e.id} className={`tone-${e.tone ?? 'info'}`}>
                {e.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  )
}
