import type { GameState } from '../types'
import { keyOf, rankLabel, suitSymbol } from '../types'
import { useGameStore } from '../state/gameStore'
import { totalWealth } from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './SidePanel.css'

export function SidePanel({ game }: { game: GameState }) {
  const pass = useGameStore((s) => s.pass)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const harvestVp = useGameStore((s) => s.harvestVp)
  const setToll = useGameStore((s) => s.setToll)
  const backToMenu = useGameStore((s) => s.backToMenu)

  const current = game.players[game.currentPlayerIndex]
  const sel = game.selection

  const selectedCell =
    sel?.type === 'stack'
      ? game.cells[keyOf(sel.x, sel.y)]
      : sel?.type === 'vp'
        ? game.cells[keyOf(sel.x, sel.y)]
        : null

  const selectedCards =
    sel?.type === 'stack' && selectedCell
      ? selectedCell.stack.slice(selectedCell.stack.length - sel.count)
      : []

  const ownDefenses = Object.values(game.cells).filter(
    (c) =>
      c.owner === current.id &&
      c.stack[0]?.suit === 'spades',
  )

  return (
    <aside className="side-panel">
      <header className="side-header">
        <div>
          <p className="eyebrow">Zug {game.turn}</p>
          <h2>
            <span
              className="player-dot"
              style={{ background: current.color }}
            />
            {current.name}
          </h2>
        </div>
        <button type="button" className="ghost-btn" onClick={backToMenu}>
          Menü
        </button>
      </header>

      <section className="stat-grid">
        <div className="stat">
          <span>Bank</span>
          <strong>{game.bank}¤</strong>
        </div>
        <div className="stat">
          <span>Bedarf</span>
          <strong>{game.demandDeck.length}</strong>
        </div>
        {game.players.map((p) => (
          <div
            key={p.id}
            className={`stat player-stat ${p.id === current.id ? 'active' : ''}`}
          >
            <span>
              <i style={{ background: p.color }} />
              {p.name}
            </span>
            <strong>
              {p.money}¤
              {p.securedVp > 0 ? ` · ${p.securedVp}◆` : ''}
            </strong>
            <em>{totalWealth(p)} Gesamt</em>
          </div>
        ))}
      </section>

      {game.missions && (
        <section className="mission-box">
          <h3>Mission</h3>
          <ul>
            {game.missions.requiredPlanets.map((pl) => (
              <li
                key={pl}
                className={
                  game.missions!.suppliedPlanets.includes(pl) ? 'done' : ''
                }
              >
                {game.missions!.suppliedPlanets.includes(pl) ? '✓' : '○'}{' '}
                {pl} versorgen
              </li>
            ))}
            <li
              className={
                game.missions.defensesDefeated >=
                game.missions.requiredDefenses
                  ? 'done'
                  : ''
              }
            >
              {game.missions.defensesDefeated >=
              game.missions.requiredDefenses
                ? '✓'
                : '○'}{' '}
              Verteidigungen {game.missions.defensesDefeated}/
              {game.missions.requiredDefenses}
            </li>
          </ul>
        </section>
      )}

      <section className="action-box">
        <h3>Aktion</h3>
        {!sel && (
          <p className="hint">
            Karte oder Stapel wählen, dann Ziel anklicken. Auf demselben
            Feld erneut klicken wechselt die Stapelhöhe. Energie auf Planeten
            → „SP erzeugen“.
          </p>
        )}

        {sel?.type === 'vp' && selectedCell && (
          <div className="sel-card">
            <p>
              Siegpunktmarker von{' '}
              <strong>{selectedCell.label ?? 'Planet'}</strong>
            </p>
            <p className="hint">Eigene Basis als Ziel wählen.</p>
            {game.pathCost != null && (
              <p className="cost-line">Route: {game.pathCost}¤</p>
            )}
            <button type="button" className="ghost-btn" onClick={clearSelection}>
              Abbrechen
            </button>
          </div>
        )}

        {sel?.type === 'stack' && selectedCell && (
          <div className="sel-card">
            <div className="sel-cards-row">
              {selectedCards.map((c) => (
                <PlayingCard key={c.id} card={c} compact />
              ))}
            </div>
            <p>
              {selectedCards
                .map((c) => `${suitSymbol(c.suit)}${rankLabel(c.rank)}`)
                .join(' · ')}
            </p>
            {game.pathCost != null && (
              <p className="cost-line">Route: {game.pathCost}¤</p>
            )}

            {selectedCell.kind === 'planet' &&
              selectedCards.every((c) => c.suit === 'hearts') && (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() =>
                    harvestVp(selectedCell.x, selectedCell.y, sel.count)
                  }
                >
                  {sel.count} Siegpunktmarker erzeugen
                </button>
              )}

            <button type="button" className="ghost-btn" onClick={clearSelection}>
              Abbrechen
            </button>
          </div>
        )}

        <div className="action-row">
          <button type="button" className="primary-btn" onClick={pass}>
            Aussetzen
          </button>
        </div>
      </section>

      {ownDefenses.length > 0 && (
        <section className="toll-box">
          <h3>Gebühren</h3>
          {ownDefenses.map((d) => (
            <label key={keyOf(d.x, d.y)} className="toll-row">
              <span>
                ({d.x},{d.y}) {suitSymbol('spades')}
                {rankLabel(d.stack[0].rank)}
              </span>
              <input
                type="number"
                min={0}
                value={d.toll}
                onChange={(e) =>
                  setToll(d.x, d.y, Number(e.target.value) || 0)
                }
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
