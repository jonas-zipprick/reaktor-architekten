import { useRef, useState } from 'react'
import { SCENARIOS } from '../data/scenarios'
import type { ScenarioId } from '../types'
import { recipeLabel } from '../types'
import { useGameStore } from '../state/gameStore'
import './ScenarioPicker.css'

export function ScenarioPicker() {
  const start = useGameStore((s) => s.start)
  const goMonteCarlo = useGameStore((s) => s.goMonteCarlo)
  const importRecord = useGameStore((s) => s.importRecord)
  const fileRef = useRef<HTMLInputElement>(null)
  const [scenarioId, setScenarioId] = useState<ScenarioId>('B')
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!
  const [importError, setImportError] = useState<string | null>(null)

  const onImportFile = async (file: File) => {
    try {
      importRecord(await file.text())
      setImportError(null)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import fehlgeschlagen')
    }
  }

  const playerCount = scenario.players.length
  const single = playerCount === 1

  return (
    <div className="menu-screen">
      <div className="menu-atmosphere" aria-hidden />
      <div className="menu-content">
        <header className="menu-hero">
          <p className="menu-kicker">Playtest-Simulation · v8</p>
          <h1>Versorgungs-Architekten</h1>
          <p className="menu-lead">
            Rohstoffe zu Produkten verarbeiten und Märkte versorgen — Karten
            teleportieren ohne Wegkosten zwischen Quellen, Fabriken, Lagern und
            Märkten.
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
                onClick={() => setScenarioId(s.id)}
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
            <h2>
              {scenario.name} · {playerCount} Spieler
            </h2>

            <div className="mode-brief">
              {single ? (
                <p>
                  Allein am Tisch. Quellen, Fabriken und Märkte sind
                  gemeinschaftlich (ohne Gebühr). Nur Lager sind staatlich —
                  keine Auktionen, kein Schenken. Ziel: die Bank leeren und
                  möglichst viel Gesamtvermögen ansammeln.
                </p>
              ) : (
                <p>
                  Höchstes Gesamtvermögen gewinnt: Bargeld + Bankforderungen.
                  Die Partie endet, sobald die Bank leer ist. Nur Lager haben
                  Eigentümer und Gebühren (Start: Staat); Quellen, Fabriken und
                  Märkte sind gebührenfrei.
                </p>
              )}
              <ul className="scenario-facts">
                {(
                  ['source', 'factory', 'storage', 'market'] as const
                ).map((kind) => {
                    const list = scenario.fields.filter((f) => f.kind === kind)
                    if (!list.length) return null
                    return (
                      <li key={kind}>
                        <strong>
                          {kind === 'source'
                            ? 'Quellen'
                            : kind === 'factory'
                              ? 'Fabriken'
                              : kind === 'storage'
                                ? 'Lager'
                                : 'Märkte'}
                        </strong>
                        {list
                          .map((f) =>
                            f.recipe
                              ? `${f.label} ${recipeLabel(f.recipe)}`
                              : f.label,
                          )
                          .join(' · ')}
                      </li>
                    )
                  },
                )}
              </ul>
            </div>

            <button
              type="button"
              className="start-btn"
              onClick={() => start(scenarioId)}
            >
              Partie starten
            </button>

            <button
              type="button"
              className="ghost-btn import-btn"
              onClick={() => goMonteCarlo()}
            >
              Monte-Carlo-Simulation
            </button>

            <button
              type="button"
              className="ghost-btn import-btn"
              onClick={() => fileRef.current?.click()}
            >
              Partie / Lauf als JSON importieren
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onImportFile(f)
                e.target.value = ''
              }}
            />
            {importError && <p className="import-error">{importError}</p>}

            <ul className="how-to">
              <li>
                Kartenbewegungen beliebig oft; „Karten ziehen und Produzieren“
                beendet den Zug
              </li>
              <li>
                Infrastruktur (Lager): Ablegen kostenlos; Abheben von
                staatlichem/fremdem Lager kostet
              </li>
              <li>
                Stapel: absteigend (7 → … → 2 → Ass); Mehrfachklick wählt
                Teilstapel
              </li>
              <li>
                Fabrik: je voller Rezept-Erfüllung ein Produkt am Zugende
                (Extras werden mit abgeräumt)
              </li>
              <li>Zugende: Bedarf je Markt −1</li>
              <li>
                Ein Exp-Zähler für alle Märkte (+1/Zugende, 10 → Ausbau); jeder
                Marktkollaps setzt ihn auf 0
              </li>
              <li>
                Quelle mit mehr als 8 Karten kollabiert (Stapel weg);
                Ablage jeder Farbe auf Quellen erlaubt
              </li>
              {!single && (
                <li>
                  Pro Zug eine Auktion: nur Lager privatisieren/verkaufen
                </li>
              )}
              {single && (
                <li>Einspieler: Lager bleiben Staat — keine Auktionen</li>
              )}
              <li>Zeitstrahl: Züge scrubben, JSON exportieren/importieren</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
