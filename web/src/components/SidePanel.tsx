import { useState } from 'react'
import type { GameState, PlayerId } from '../types'
import { useGameStore } from '../state/gameStore'
import {
  auctionInfo,
  checkMove,
  describeCard,
  totalWealth,
} from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './SidePanel.css'

export function SidePanel({ game }: { game: GameState }) {
  const undo = useGameStore((s) => s.undo)
  const viewIndex = useGameStore((s) => s.viewIndex)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const setFee = useGameStore((s) => s.setFee)
  const endTurn = useGameStore((s) => s.endTurn)
  const gift = useGameStore((s) => s.gift)
  const openAuction = useGameStore((s) => s.openAuction)
  const backToMenu = useGameStore((s) => s.backToMenu)
  const goMonteCarlo = useGameStore((s) => s.goMonteCarlo)
  const moveAnim = useGameStore((s) => s.moveAnim)
  const auction = useGameStore((s) => s.auction)

  const [auctionField, setAuctionField] = useState('')
  const [giftTo, setGiftTo] = useState<PlayerId | ''>('')
  const [giftAmount, setGiftAmount] = useState(1)

  const current = game.players[game.currentPlayerIndex]!
  const busy = game.ended || Boolean(moveAnim) || Boolean(auction)

  const selectedField = game.selection
    ? game.fields[game.selection.fieldId]
    : null
  const selectedCount = game.selection?.count ?? 0
  const selectedCards =
    selectedField && selectedCount > 0
      ? selectedField.stack.slice(selectedField.stack.length - selectedCount)
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

  const ownFields = Object.values(game.fields).filter(
    (f) => f.owner === current.id,
  )

  const auctionable = Object.values(game.fields).filter(
    (f) => auctionInfo(game, f.id).ok,
  )
  const auctionChoice = auctionable.some((f) => f.id === auctionField)
    ? auctionField
    : (auctionable[0]?.id ?? '')

  const others = game.players.filter((p) => p.id !== current.id)
  const giftTarget = others.some((p) => p.id === giftTo)
    ? (giftTo as PlayerId)
    : others[0]?.id

  return (
    <aside className="side-panel">
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
          <button type="button" className="ghost-btn" onClick={goMonteCarlo}>
            Monte Carlo
          </button>
          <button type="button" className="ghost-btn" onClick={backToMenu}>
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
                  ? `${p.money}¤ Bargeld + ${p.bankClaims} Bankforderungen`
                  : `${p.money}¤ Bargeld`
              }
            >
              <span className="balance-name">
                <i style={{ background: p.color }} />
                {p.name}
              </span>
              <strong className="balance-money">{p.money}¤</strong>
              <em>{totalWealth(p)} Ges.</em>
            </div>
          )
        })}
      </section>

      <section className="stat-grid">
        <div className="stat bank-stat">
          <span>Bank</span>
          <strong>{game.bank}¤</strong>
        </div>
      </section>

      <section className="action-box">
        <h3>Aktion</h3>
        {!selectedField && (
          <p className="hint">
            Stapel anklicken, ggf. mehrfach für größere absteigende Auswahl, dann
            das Ziel. Bewegungen kosten keine Aktion — nur Abheben von fremden
            oder staatlichen Lagern kostet.
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
            <button type="button" className="ghost-btn" onClick={clearSelection}>
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

      {game.players.length > 1 && !game.ended && (
        <section className="market-box">
          <h3>Markt</h3>
          <div className="market-row">
            <select
              aria-label="Lager zur Auktion"
              value={auctionChoice}
              disabled={busy || auctionable.length === 0}
              onChange={(e) => setAuctionField(e.target.value)}
            >
              {auctionable.length === 0 && (
                <option value="">
                  {game.auctionUsed ? 'Auktion bereits genutzt' : 'Kein Lager'}
                </option>
              )}
              {auctionable.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({f.owner === 'state' ? 'Staat' : 'eigen'})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !auctionChoice}
              onClick={() => openAuction(auctionChoice)}
              title="Höchstens eine Auktion pro Zug"
            >
              Auktion
            </button>
          </div>

          {others.length > 0 && giftTarget && (
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
                  setGiftAmount(Math.max(1, Math.floor(Number(e.target.value)) || 1))
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
          )}
        </section>
      )}

      {game.players.length > 1 && ownFields.length > 0 && !game.ended && (
        <section className="toll-box">
          <h3>Eigene Gebühren</h3>
          {ownFields.map((f) => (
            <label key={f.id} className="toll-row">
              <span>{f.label}</span>
              <input
                type="number"
                min={0}
                value={f.fee}
                disabled={busy}
                onChange={(e) => setFee(f.id, Number(e.target.value) || 0)}
              />
            </label>
          ))}
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
    </aside>
  )
}
