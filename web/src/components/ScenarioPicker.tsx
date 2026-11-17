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
            Jeder hat ein eigenes Beet, erntet und verkauft, füllt drei
            Erntefelder (Sorten mischbar). Spielende bei Zugende mit drei
            vollen Stapeln — Sieger nach Siegpunkten (Ernte + Taler).
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
                  Allein im Garten mit Apfelbeet. Mit drei vollen Erntefeldern
                  den Zug beenden → Wertung (Ernte-SP + Taler). Saatstand und Markt
                  sind gemeinschaftlich.
                </p>
              ) : (
                <p>
                  Jeder hat ein anderes Beet. Alle Beet-Ernten zählen auf den
                  Erntefeldern (mischbar). Wer zuerst drei volle Stapel hat und
                  den Zug beendet, löst die Wertung aus — gewinnen tut die
                  höchste SP-Summe (Ernte + Taler). Private Felder sind tabu.
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
                  1 Regen · 1 Beet · 1 Schuppen · 3 Erntefelder
                </li>
                <li>
                  <strong>Gemeinschaft</strong>
                  Saatstand · Markt (Ernte & Saat)
                </li>
                <li>
                  <strong>Karten</strong>
                  {scenario.cardsPerSuit} je Sorte
                </li>
                <li>
                  <strong>Sieg</strong>
                  Ernte-SP (1–4 Sorten → 2–5) + 1 SP je angefangene 10T
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
                Stapel: absteigend (7 → … → 2); Mehrfachklick wählt
                Teilstapel
              </li>
              <li>
                Je Spieler ein Beet nach Sitz (Obst/Beeren/Gemüse/Kräuter),
                eigener Regen; Beete ohne Bedarf/Geld, Zugende
                bei Wasser+Saat Eingang→Ausgabe
              </li>
              <li>
                Saatstand &amp; Wasserhandel: Bedarfsmesser; Ausgabe bei
                Bedarf &lt; 0 kostenpflichtig; Eingänge abrechnen am Zugende
              </li>
              <li>
                Markt: 3 Stände 2/4/6T, Preis 0…7; Auszahlung an Ableger;
                Entnahme kostet Standpreis (auch Markt→Markt)
              </li>
              <li>
                Zugende: Regen-Würfel 0/1/1/1/2/2, Markt-Würfel 0/0/1/1/1/2;
                Depot +1;
                Beete; Preisanzeige Depot/Markt 0…7
              </li>
              <li>Zeitstrahl: Züge scrubben, JSON exportieren/importieren</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
