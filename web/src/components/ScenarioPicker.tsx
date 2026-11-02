import { useState } from 'react'
import { SCENARIOS } from '../data/scenarios'
import type { GameMode, ScenarioId } from '../types'
import { useGameStore } from '../state/gameStore'
import './ScenarioPicker.css'

export function ScenarioPicker() {
  const start = useGameStore((s) => s.start)
  const [scenarioId, setScenarioId] = useState<ScenarioId>('A')
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!
  const [mode, setMode] = useState<GameMode>(scenario.modes[0])

  const pickScenario = (id: ScenarioId) => {
    setScenarioId(id)
    const s = SCENARIOS.find((x) => x.id === id)!
    if (!s.modes.includes(mode)) setMode(s.modes[0])
  }

  return (
    <div className="menu-screen">
      <div className="menu-atmosphere" aria-hidden />
      <div className="menu-content">
        <header className="menu-hero">
          <p className="menu-kicker">Playtest-Simulation · v6.6</p>
          <h1>Versorgungs-Architekten</h1>
          <p className="menu-lead">
            Energie stapeln, Wege kontrollieren, Siegpunkte sichern — auf einem
            gemeinsamen Raster aus Sonnen, Planeten und Verteidigungen.
          </p>
        </header>

        <div className="menu-layout">
          <section className="scenario-list">
            <h2>Szenario</h2>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`scenario-card ${s.id === scenarioId ? 'active' : ''}`}
                onClick={() => pickScenario(s.id)}
              >
                <span className="scenario-id">{s.id}</span>
                <span className="scenario-body">
                  <strong>{s.name}</strong>
                  <em>{s.description}</em>
                </span>
              </button>
            ))}
          </section>

          <section className="mode-panel">
            <h2>Modus</h2>
            <div className="mode-row">
              {scenario.modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`mode-chip ${mode === m ? 'active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'solo' ? 'Solo' : m === 'coop' ? 'Koop' : 'Versus'}
                </button>
              ))}
            </div>

            <div className="mode-brief">
              {mode === 'solo' && (
                <p>
                  Versorge den Missionsplaneten und besiege eine neutrale
                  Verteidigung, bevor Bank oder Bedarf enden.
                </p>
              )}
              {mode === 'coop' && (
                <p>
                  Zwei Spieler, getrennte Kassen. Beide Planeten versorgen und
                  zwei Verteidigungen besiegen.
                </p>
              )}
              {mode === 'versus' && (
                <p>
                  Höchstes Gesamtvermögen gewinnt: Geld + Bankforderungen + 5×
                  gesicherte Siegpunkte.
                </p>
              )}
            </div>

            <button
              type="button"
              className="start-btn"
              onClick={() => start(scenarioId, mode)}
            >
              Partie starten
            </button>

            <ul className="how-to">
              <li>Eine Kartenaktion pro Zug</li>
              <li>Absteigende Stapel gemeinsam transportieren</li>
              <li>Energie vom Planeten → Siegpunktmarker → eigene Basis</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
