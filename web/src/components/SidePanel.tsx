import type { GameState } from '../types'
import { keyOf, rankLabel, suitSymbol } from '../types'
import { useGameStore } from '../state/gameStore'
import { describeCard, totalWealth } from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './SidePanel.css'

export function SidePanel({ game }: { game: GameState }) {
  const undo = useGameStore((s) => s.undo)
  const canUndo = useGameStore((s) => s.canUndo)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const setToll = useGameStore((s) => s.setToll)
  const backToMenu = useGameStore((s) => s.backToMenu)

  const current = game.players[game.currentPlayerIndex]
  const sel = game.selection

  const selectedCell =
    sel?.type === 'stack' ? game.cells[keyOf(sel.x, sel.y)] : null

  const selectedCards =
    sel?.type === 'stack' && selectedCell
      ? selectedCell.stack.slice(selectedCell.stack.length - sel.count)
      : []

  const ownFeeFields = Object.values(game.cells).filter(
    (c) =>
      c.kind === 'empty' &&
      c.owner === current.id &&
      c.stack.length > 0,
  )

  const planets = Object.values(game.cells).filter((c) => c.kind === 'planet')

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
        <div className="stat player-stat active own-money">
          <span>
            <i style={{ background: current.color }} />
            {current.name}
          </span>
          <strong>{current.money}¤</strong>
          <em>{totalWealth(current)} Gesamt</em>
        </div>
        <div className="stat vp-stat">
          <span>Siegpunkte</span>
          <strong>{current.securedVp}◆</strong>
        </div>
        <div className="stat">
          <span>Bank</span>
          <strong>{game.bank}¤</strong>
        </div>
        {game.players
          .filter((p) => p.id !== current.id)
          .map((p) => (
            <div key={p.id} className="stat player-stat">
              <span>
                <i style={{ background: p.color }} />
                {p.name}
              </span>
              <strong>
                {p.money}¤ · {p.securedVp}◆
              </strong>
              <em>{totalWealth(p)} Gesamt</em>
            </div>
          ))}
      </section>

      {planets.length > 0 && (
        <section className="tension-box">
          <h3>Spannung</h3>
          <ul>
            {planets.map((p) => (
              <li
                key={keyOf(p.x, p.y)}
                className={Math.abs(p.tension) >= 5 ? 'danger' : ''}
              >
                <span>{p.label ?? 'Planet'}</span>
                <strong>
                  {p.tension > 0 ? '+' : ''}
                  {p.tension}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      )}

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
            Eine Kartenaktion beendet den Zug. Ass auf der Sonne aufdecken
            → Bedarf würfeln. Shift+Klick setzt Wegpunkte. Esc oder Rechtsklick
            bricht ab.
          </p>
        )}

        {game.actionError && (
          <p className="action-error">{game.actionError}</p>
        )}

        {sel?.type === 'stack' && selectedCell && (
          <div className="sel-card">
            <div className="sel-cards-row">
              {selectedCards.map((c) => (
                <PlayingCard key={c.id} card={c} compact />
              ))}
            </div>
            <p>
              {selectedCards.map((c) => describeCard(c)).join(' · ')}
            </p>
            {game.pathCost != null && (
              <p className="cost-line">Route: {game.pathCost}¤</p>
            )}
            <p className="hint">
              Ziel anklicken. Shift+Klick auf leere Felder = Wegpunkt.
            </p>
            <button type="button" className="ghost-btn" onClick={clearSelection}>
              Abbrechen
            </button>
          </div>
        )}

        <div className="action-row">
          <button
            type="button"
            className="ghost-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Letzten Spielzug rückgängig machen"
          >
            Rückgängig
          </button>
        </div>
      </section>

      {ownFeeFields.length > 0 && (
        <section className="toll-box">
          <h3>Gebühren</h3>
          {ownFeeFields.map((d) => {
            const top = d.stack[d.stack.length - 1]
            return (
              <label key={keyOf(d.x, d.y)} className="toll-row">
                <span>
                  ({d.x},{d.y}) {suitSymbol(top.suit)}
                  {rankLabel(top.rank)}
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
            )
          })}
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
