import { FACTORY_UPKEEP } from '../data/boardLayout'
import {
  DIFFICULTY_LABELS,
  missionForDifficulty,
} from '../data/difficulty'
import { FIELD_DEFS } from '../data/fields'
import { freibeuterLabel } from '../data/freibeuter'
import { METER_LABELS, playerFull, playerLabel } from '../data/labels'
import { GAME_MODE_LABELS, getScenario } from '../data/scenarios'
import { PHASES, useGame } from '../state/gameStore'
import './SidePanel.css'

export function SidePanel() {
  const day = useGame((s) => s.day)
  const phase = useGame((s) => s.phase)
  const activePlayer = useGame((s) => s.activePlayer)
  const playerIds = useGame((s) => s.playerIds)
  const scenarioId = useGame((s) => s.scenarioId)
  const gameMode = useGame((s) => s.gameMode)
  const difficulty = useGame((s) => s.difficulty)
  const freibeuters = useGame((s) => s.freibeuters)
  const piratePurse = useGame((s) => s.piratePurse)
  const players = useGame((s) => s.players)
  const ships = useGame((s) => s.ships)
  const bank = useGame((s) => s.bank)
  const orderHolder = useGame((s) => s.orderHolder)
  const actionsLeft = useGame((s) => s.actionsLeft)
  const upkeepPlayer = useGame((s) => s.upkeepPlayer)
  const cells = useGame((s) => s.cells)
  const log = useGame((s) => s.log)
  const lost = useGame((s) => s.lost)
  const lossReason = useGame((s) => s.lossReason)
  const gameOver = useGame((s) => s.gameOver)
  const winner = useGame((s) => s.winner)

  const ai = useGame((s) => s.ai)
  const setAi = useGame((s) => s.setAi)
  const giveMoney = useGame((s) => s.giveMoney)
  const nextPhase = useGame((s) => s.nextPhase)
  const setPhase = useGame((s) => s.setPhase)
  const setActivePlayer = useGame((s) => s.setActivePlayer)
  const adjustMoney = useGame((s) => s.adjustMoney)
  const closeForUpkeep = useGame((s) => s.closeForUpkeep)
  const reset = useGame((s) => s.reset)
  const undo = useGame((s) => s.undo)
  const pastLen = useGame((s) => s.past.length)

  const scenario = scenarioId ? getScenario(scenarioId) : null
  const scenarioName = scenario?.name ?? null
  const rawMission =
    gameMode === 'solo' || gameMode === 'coop'
      ? scenario?.missions?.[gameMode]
      : undefined
  const mission = rawMission
    ? missionForDifficulty(rawMission, difficulty ?? 'normal')
    : undefined
  const nextActor =
    playerIds[(playerIds.indexOf(activePlayer) + 1) % playerIds.length] ??
    activePlayer

  return (
    <aside className="side-panel">
      <header className="brand-block">
        <p className="brand-eyebrow">Playtest</p>
        <h1 className="brand-title">Versorgungs-Architekten</h1>
        <p className="brand-sub">
          {GAME_MODE_LABELS[gameMode]}
          {mission ? ` · ${DIFFICULTY_LABELS[difficulty ?? 'normal']}` : ''} · Tag{' '}
          {day}
          {mission ? `/${mission.rounds}` : ''} · Bank {bank}
          {scenarioName ? ` · ${scenarioName}` : ''}
        </p>
      </header>

      {lost && (
        <div className="loss-banner" role="alert">
          <strong>Verloren</strong>
          <span>{lossReason}</span>
          <button type="button" className="btn ghost" onClick={reset}>
            Szenario wählen
          </button>
        </div>
      )}

      {gameOver && !lost && (
        <div className="loss-banner win-banner" role="status">
          <strong>Spielende</strong>
          <span>
            {winner === 'mission'
              ? 'Mission gewonnen'
              : winner === 'draw'
                ? 'Gleichstand — Gewinn als Team'
                : winner
                  ? `${playerFull(winner)} gewinnt`
                  : 'Fertig'}
          </span>
          <button type="button" className="btn ghost" onClick={reset}>
            Szenario wählen
          </button>
        </div>
      )}

      {mission && !gameOver && (
        <section className="panel-card">
          <div className="panel-head">
            <h2>Mission</h2>
            <span className="muted">
              {DIFFICULTY_LABELS[difficulty ?? 'normal']} · bis R
              {mission.consumerDeadline} Verbraucher · R
              {mission.stableRounds.join('+')} stabil
            </span>
          </div>
          <ul className="mission-list">
            {mission.planets.map((p) => {
              const cell = Object.values(cells).find(
                (c) => c.terrain === 'planet' && c.planetName === p.planetName,
              )
              const have = new Set(cell?.consumers.map((c) => c.type) ?? [])
              return (
                <li key={p.planetName}>
                  <strong>{p.planetName}</strong> ({playerLabel(p.owner)})
                  <span className="hint">
                    {' '}
                    braucht{' '}
                    {p.needByRound8
                      .map((k) =>
                        have.has(k)
                          ? `✓ ${METER_LABELS[k]}`
                          : METER_LABELS[k],
                      )
                      .join(', ')}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {freibeuters.length > 0 && (
        <section className="panel-card">
          <div className="panel-head">
            <h2>Freibeuter</h2>
            <span className="muted">Kasse {piratePurse}</span>
          </div>
          <ul className="mission-list freibeuter-list">
            {freibeuters.map((f) => (
              <li key={f.id}>
                <strong>{freibeuterLabel(f)}</strong>
                <span className="hint">
                  {' '}
                  @ ({f.hex.q},{f.hex.r}) ·{' '}
                  {f.patrol === 'loop' ? 'Kreis' : 'Pendel'}
                </span>
              </li>
            ))}
          </ul>
          <p className="hint">
            Ab Runde 2 bewegen sie sich je 1 Feld. Chip-Besuch kostet die Gebühr
            zusätzlich — Geld geht in die Freibeuterkasse.
          </p>
        </section>
      )}

      <section className="panel-card">
        <div className="panel-head">
          <h2>Phase</h2>
          <button
            type="button"
            className="btn"
            onClick={nextPhase}
            title="Leertaste oder Enter"
            disabled={gameOver || upkeepPlayer != null}
          >
            Weiter → <kbd className="kbd">Leertaste</kbd>
            <kbd className="kbd">Enter</kbd>
          </button>
        </div>
        <div className="phase-track">
          {PHASES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`phase-pill ${p.id === phase ? 'active' : ''}`}
              onClick={() => setPhase(p.id)}
              disabled={gameOver || upkeepPlayer != null}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {phase === 'simulate' && <SimulationPanel />}

      {upkeepPlayer && (
        <section className="panel-card">
          <div className="panel-head">
            <h2>Unterhalt</h2>
          </div>
          <p className="hint">
            {playerLabel(upkeepPlayer)} hat {players[upkeepPlayer].money} Geld
            und{' '}
            {
              Object.values(cells).filter(
                (c) => c.field?.owner === upkeepPlayer,
              ).length
            }{' '}
            Fabriken. Unterhalt ist {FACTORY_UPKEEP} Geld je Fabrik. Neutralisiere
            welche, bis der Rest bezahlbar ist. Die Fabrik bleibt auf dem Feld.
          </p>
          <div className="btn-row wrap">
            {Object.values(cells)
              .filter((c) => c.field?.owner === upkeepPlayer)
              .map((c) => (
                <button
                  key={`${c.hex.q},${c.hex.r}`}
                  type="button"
                  className="btn danger compact"
                  onClick={() => closeForUpkeep(c.hex)}
                >
                  {FIELD_DEFS[c.field!.kind].name} ({c.hex.q},{c.hex.r}){' '}
                  neutralisieren
                </button>
              ))}
          </div>
        </section>
      )}

      <section className="panel-card">
        <div className="panel-head">
          <h2>Spieler</h2>
          <div className="player-toggle">
            {playerIds.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn compact owner-${p} ${activePlayer === p ? 'active' : ''}`}
                onClick={() => {
                  if (phase !== 'act') setActivePlayer(p)
                }}
                disabled={phase === 'act' || phase === 'simulate'}
                title={
                  phase === 'act'
                    ? `In der Aktionsphase beginnt ${playerLabel(orderHolder)}.`
                    : phase === 'simulate'
                      ? 'In der Simulation wechselt der Zug nach jedem Chip.'
                      : undefined
                }
              >
                {playerLabel(p)}
              </button>
            ))}
          </div>
        </div>
        <div className={`players-grid seats-${playerIds.length}`}>
          {playerIds.map((p) => (
            <div
              key={p}
              className={`player-col owner-${p} ${activePlayer === p ? 'is-active' : ''}`}
            >
              <div className="stat-row">
                <span>Geld</span>
                <div className="stepper">
                  <button type="button" onClick={() => adjustMoney(p, -1)}>
                    −
                  </button>
                  <strong>
                    {players[p].money}
                    {(players[p].owed ?? 0) > 0
                      ? ` +${players[p].owed}`
                      : ''}
                  </strong>
                  <button type="button" onClick={() => adjustMoney(p, 1)}>
                    +
                  </button>
                </div>
              </div>
              <p className="hint ship-pos">
                Schiff ({ships[p].q},{ships[p].r})
                {phase === 'act' ? ` · ${actionsLeft[p] ?? 0} AP` : ''}
                {orderHolder === p ? ' · Reihenfolge' : ''}
              </p>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={ai[p]}
                  onChange={(event) => setAi(p, event.target.checked)}
                />
                Computer
              </label>
            </div>
          ))}
        </div>
        {phase === 'act' && (
          <div className="btn-row wrap" style={{ marginTop: '0.4rem' }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => giveMoney(1)}
            >
              1 Geld an {playerLabel(nextActor)}
            </button>
          </div>
        )}
      </section>

      <section className="panel-card log-card">
        <div className="panel-head">
          <h2>Log</h2>
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost compact"
              onClick={undo}
              disabled={pastLen === 0}
              title="Strg+Z"
            >
              Undo <kbd className="kbd">Ctrl+Z</kbd>
            </button>
            <button type="button" className="btn ghost compact" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
        <ul className="log-list">
          {log.map((line, i) => (
            <li key={`${i}-${line.slice(0, 12)}`}>{line}</li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

function SimulationPanel() {
  const activePlayer = useGame((s) => s.activePlayer)
  const simDone = useGame((s) => s.simDone)
  const simPasses = useGame((s) => s.simPasses)

  return (
    <section className="panel-card">
      <div className="panel-head">
        <h2>Simulation</h2>
        <span className="muted">
          {playerLabel(activePlayer)}
          {simDone ? ' · Ende' : simPasses === 1 ? ' · 1 Pass' : ''}
        </span>
      </div>
      <p className="hint">
        {simDone
          ? 'Alle haben gepasst. Nicht entnommene Chips bleiben auf den Quellen, Speicherladungen bleiben in der Fabrik.'
          : 'Chips, Wege, Fabriken und Lieferungen liegen auf dem Spielfeld. Passen steht unter dem Brett.'}
      </p>
    </section>
  )
}
