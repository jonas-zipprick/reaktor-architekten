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
          <p className="menu-kicker">Playtest · Garten & Wochenmarkt</p>
          <h1>Ernte & Wochenmarkt</h1>
          <p className="menu-lead">
            Saat und Getreide ernten, zu Obst und Mehl veredeln, Konfitüre kochen
            und Mehl, Obst und Konfitüre auf die eigenen Erntefelder legen.
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
                  Allein im Garten. Felder und Küchen sind gemeinschaftlich, bis
                  jemand sie kauft. Dein Schuppen und die Erntefelder gehören
                  dir. Sieg, wenn Mehl, Obst und Konfitüre jeweils auf einem
                  eigenen Erntefeld liegen. Ohne Geld geht die Partie weiter.
                </p>
              ) : (
                <p>
                  Sieg, wenn Mehl, Obst und Konfitüre jeweils auf einem eigenen
                  Erntefeld liegen. Leere Kasse beendet nichts. Jeder hat einen
                  Schuppen und drei Erntefelder; gekaufte Felder und Küchen
                  gehören dem Käufer (Gebühr setzbar).
                </p>
              )}
              <ul className="scenario-facts">
                {(
                  ['source', 'factory'] as const
                ).map((kind) => {
                    const list = scenario.fields.filter((f) => f.kind === kind)
                    if (!list.length) return null
                    return (
                      <li key={kind}>
                        <strong>
                          {kind === 'source' ? 'Felder' : 'Küchen'}
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
                <li>
                  <strong>Je Spieler</strong>
                  1 Schuppen · 3 Erntefelder
                </li>
                <li>
                  <strong>Gemeinschaft</strong>
                  1 Markt (nur Eingang, Küchenware)
                </li>
                <li>
                  <strong>Karten</strong>
                  {scenario.cardsPerSuit} je Sorte
                </li>
                <li>
                  <strong>Siegziel</strong>
                  Mehl, Obst und Konfitüre je auf einem eigenen Erntefeld
                </li>
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
                + kauft Getreidefeld, Mehlmühle, Konfitürenküche (20¤, 40¤,
                80¤, …)
              </li>
              <li>
                Stapel: absteigend (7 → … → 2); Mehrfachklick wählt
                Teilstapel
              </li>
              <li>
                Küche & Saatstand: offene Ausgabekarten per Mehrfachklick
                (Gebühr nur bei Bedarf &lt; 0; bei ≥ 0 Ziehen gratis, Abliefern
                ohne Belohnung);
                Eingänge (Küche, Saatstand, Markt) entnehmbar — Abrechnung am
                Zugende
              </li>
              <li>
                Zugende: Regen/Getreide +1; Ausgaben +1 offen; Eingänge
                abrechnen; &gt;+5 → Extra-Ausgabestapel; unter −8 → Feld weg
              </li>
              <li>Zeitstrahl: Züge scrubben, JSON exportieren/importieren</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
