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
            und an den Ständen verkaufen — Karten wandern frei zwischen Feldern,
            Küchen, Schuppen und Marktständen.
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
                  Allein im Garten. Felder, Küchen und Stände sind
                  gemeinschaftlich, bis jemand sie kauft. Schuppen gehören dir
                  persönlich. Einziges Siegziel: {scenario.marketsToWin} Märkte
                  mit Versorgung &gt; 0 am Zugende. Ohne Geld geht die Partie
                  weiter.
                </p>
              ) : (
                <p>
                  Einziges Siegziel: {scenario.marketsToWin} Märkte mit
                  Versorgung &gt; 0 am Zugende. Leere Kasse beendet nichts. Jeder
                  hat eigene Schuppen; gekaufte Felder/Küchen/Stände gehören dem
                  Käufer (Gebühr setzbar).
                </p>
              )}
              <ul className="scenario-facts">
                {(
                  ['source', 'factory', 'market'] as const
                ).map((kind) => {
                    const list = scenario.fields.filter((f) => f.kind === kind)
                    if (!list.length) return null
                    return (
                      <li key={kind}>
                        <strong>
                          {kind === 'source'
                            ? 'Felder'
                            : kind === 'factory'
                              ? 'Küchen'
                              : 'Stände'}
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
                  {scenario.beetsPerPlayer} Schuppen
                </li>
                <li>
                  <strong>Siegziel</strong>
                  {scenario.marketsToWin}× Versorgung &gt; 0
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
                + kauft Schuppen, Getreidefeld, Mehlmühle, Konfitürenküche,
                Mehl- und Konfitürenstand (20¤, 40¤, 80¤, …)
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
                Zugende: Regen/Getreide +1; Ausgaben +1 offen; Märkte &amp;
                Eingänge abrechnen; &gt;+5 → Extra-Stapel
                käuflich; über +5 oder unter −8 → Feld weg (kein Markt =
                verloren)
              </li>
              <li>
                Regen/Getreide am Zugende mehr als 8 Karten: Überernte (Stapel
                weg)
              </li>
              <li>Zeitstrahl: Züge scrubben, JSON exportieren/importieren</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
