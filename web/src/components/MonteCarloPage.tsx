import { useEffect, useMemo, useState } from 'react'
import { SCENARIOS } from '../data/scenarios'
import { useGameStore } from '../state/gameStore'
import {
  ALL_OUTCOMES,
  filterSortResults,
  parseScenarioId,
  useMonteCarloStore,
  type SortKey,
} from '../state/monteCarloStore'
import type { SimOutcome } from '../sim/types'
import type { SimRunSummary } from '../sim/mcStorage'
import './MonteCarloPage.css'

const OUTCOME_LABEL: Record<SimOutcome, string> = {
  finished: 'Sieg',
  lost: 'Niederlage',
  stalled: 'Stillstand',
  aborted: 'Abbruch',
  stuck: 'Fehler',
}

const COLUMNS: { key: SortKey; label: string; tip: string }[] = [
  {
    key: 'seed',
    label: 'Seed',
    tip: 'Zufalls-Seed der Partie. Gleicher Seed + gleiche Heuristik = gleicher Ablauf.',
  },
  {
    key: 'outcome',
    label: 'Ergebnis',
    tip: 'Sieg = 3 Siegpunkte-Spalten voll (je 6 Karten, 7→2). Niederlage = kein Marktstand mehr. Stillstand = nur Zugenden. Abbruch = Aktionslimit. Fehler = Bot ohne gültige Aktion.',
  },
  {
    key: 'leader',
    label: 'Führend',
    tip: 'Spieler mit dem höchsten Gesamtvermögen am Ende (mehrere bei Gleichstand).',
  },
  {
    key: 'wealthMax',
    label: 'Verm. max',
    tip: 'Höchstes Gesamtvermögen: Bargeld + Bankforderungen.',
  },
  {
    key: 'wealthMin',
    label: 'Verm. min',
    tip: 'Niedrigstes Gesamtvermögen — Abstand zu „Verm. max“ zeigt die Spreizung.',
  },
  {
    key: 'bankClaims',
    label: 'Forder.',
    tip: 'Summe aller Bankforderungen: Einkommen, das die leere Bank schuldig blieb.',
  },
  {
    key: 'productions',
    label: 'Prod.',
    tip: 'Karten, die am Zugende auf Ausgabestapel (Küchen/Saatstand) gelegt wurden.',
  },
  {
    key: 'productsDelivered',
    label: 'Lief.',
    tip: 'Produktkarten, die auf Marktstände geliefert wurden.',
  },
  {
    key: 'marketCollapses',
    label: 'M-Kol.',
    tip: 'Felder mit Bedarfsmesser entfernt (unter −8 oder über +5).',
  },
  {
    key: 'sourceCollapses',
    label: 'Q-Kol.',
    tip: 'Quellen-Kollapse (am Zugende noch mehr als 8 Karten auf dem Stapel).',
  },
  {
    key: 'marketsSpawned',
    label: 'Spawn',
    tip: 'Extra-Stapel/Eingänge durch Überversorgung (>+5).',
  },
  {
    key: 'marketIncome',
    label: 'Eink.',
    tip: 'Einkommen aus Markt-Lieferungen.',
  },
  {
    key: 'feesPaidToPlayers',
    label: 'Geb.→Sp.',
    tip: 'Summe aller Gebühren, die Spieler an andere Spieler gezahlt haben.',
  },
  {
    key: 'feesPaidToBank',
    label: 'Geb.→Bank',
    tip: 'Summe Gebühren und Kaufpreise an die Bank.',
  },
  {
    key: 'privateBusinesses',
    label: 'Privat',
    tip: 'Felder/Küchen/Stände/Schuppen in Privatbesitz am Ende.',
  },
  {
    key: 'fieldsBought',
    label: 'Käufe',
    tip: 'Anzahl gekaufter Felder (Infrastruktur) während der Partie.',
  },
  {
    key: 'actions',
    label: 'Aktionen',
    tip: 'Aufgezeichnete Aktionen (Kartenbewegungen, Käufe, Gebühren, Zugenden).',
  },
  {
    key: 'turns',
    label: 'Runden',
    tip: 'Spielrunde am Ende (steigt, wenn wieder der Startspieler an der Reihe ist).',
  },
  {
    key: 'bankLeft',
    label: 'Bank',
    tip: 'Verbleibendes Bankgeld am Ende (Start 2000¤; leere Bank beendet nicht).',
  },
  {
    key: 'durationMs',
    label: 'ms',
    tip: 'Rechenzeit dieser Simulation in Millisekunden.',
  },
]

export function MonteCarloPage() {
  const backToMenu = useGameStore((s) => s.backToMenu)
  const openRecord = useGameStore((s) => s.importRecord)

  const config = useMonteCarloStore((s) => s.config)
  const setConfig = useMonteCarloStore((s) => s.setConfig)
  const progress = useMonteCarloStore((s) => s.progress)
  const start = useMonteCarloStore((s) => s.start)
  const resume = useMonteCarloStore((s) => s.resume)
  const pause = useMonteCarloStore((s) => s.pause)
  const clearResults = useMonteCarloStore((s) => s.clearResults)
  const hydrateFromDisk = useMonteCarloStore((s) => s.hydrateFromDisk)
  const loadRecordJson = useMonteCarloStore((s) => s.loadRecordJson)
  const sortKey = useMonteCarloStore((s) => s.sortKey)
  const sortDir = useMonteCarloStore((s) => s.sortDir)
  const setSort = useMonteCarloStore((s) => s.setSort)
  const filters = useMonteCarloStore((s) => s.filters)
  const setFilters = useMonteCarloStore((s) => s.setFilters)
  const error = useMonteCarloStore((s) => s.error)
  const persistError = useMonteCarloStore((s) => s.persistError)
  const results = useMonteCarloStore((s) => s.results)
  const rows = useMemo(
    () => filterSortResults({ results, filters, sortKey, sortDir }),
    [results, filters, sortKey, sortDir],
  )
  const [opening, setOpening] = useState<number | null>(null)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize) || 1)
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(() => {
    const start = safePage * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, safePage, pageSize])

  useEffect(() => {
    setPage(0)
  }, [filters, sortKey, sortDir, pageSize])

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1))
  }, [page, pageCount])

  const hw =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  const workerLabel =
    config.workers > 0 ? String(config.workers) : `auto (${hw})`

  useEffect(() => {
    if (progress.running) return
    void hydrateFromDisk()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- einmal beim Öffnen
  }, [])

  useEffect(() => {
    if (progress.running) return
    void hydrateFromDisk()
    // Bei Parameterwechsel gespeicherte Läufe laden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.scenarioId, config.heuristic])

  const openRun = async (run: SimRunSummary) => {
    setOpening(run.seed)
    try {
      const json = await loadRecordJson(run.seed)
      if (!json) {
        window.alert(
          `Kein gespeicherter Record für Seed ${run.seed} (noch nicht geschrieben oder gelöscht).`,
        )
        return
      }
      openRecord(json)
    } catch (e) {
      window.alert(
        e instanceof Error
          ? e.message
          : `Record Seed ${run.seed} konnte nicht geöffnet werden.`,
      )
    } finally {
      setOpening(null)
    }
  }

  const finished = results.filter((r) => r.outcome === 'finished').length
  const lost = results.filter((r) => r.outcome === 'lost').length

  return (
    <div className="mc-page">
      <header className="mc-header">
        <div>
          <p className="mc-kicker">Dauerlauf-Simulation</p>
          <h1>Monte Carlo</h1>
          <p className="mc-lead">
            Seeds fortlaufend parallel durchspielen, pausieren wann du willst.
            Vollständige Partien liegen in IndexedDB — die Tabelle hält nur
            Kennzahlen.
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => backToMenu()}>
          Menü
        </button>
      </header>

      <section className="mc-config">
        <h2>Parameter</h2>
        <div className="mc-grid">
          <label>
            Szenario
            <select
              value={config.scenarioId}
              disabled={progress.running}
              onChange={(e) => {
                setConfig({ scenarioId: parseScenarioId(e.target.value) })
              }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} — {s.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Start-Seed
            <input
              type="number"
              min={0}
              disabled={progress.running || progress.paused}
              value={config.startSeed}
              onChange={(e) =>
                setConfig({ startSeed: Number(e.target.value) || 0 })
              }
            />
          </label>

          <label>
            Max. Aktionen (Abbruch)
            <input
              type="number"
              min={10}
              max={20000}
              disabled={progress.running}
              value={config.maxActions}
              onChange={(e) =>
                setConfig({
                  maxActions: Math.max(10, Number(e.target.value) || 10),
                })
              }
            />
          </label>

          <label>
            Worker ({workerLabel})
            <input
              type="number"
              min={0}
              max={64}
              disabled={progress.running}
              value={config.workers}
              title="0 = hardwareConcurrency"
              onChange={(e) =>
                setConfig({ workers: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>

          <label className="mc-span">
            Heuristik {config.heuristic.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={progress.running}
              value={config.heuristic}
              onChange={(e) =>
                setConfig({ heuristic: Number(e.target.value) })
              }
            />
            <span className="mc-hint">
              0 = zufällig · 1 = beste Aktion (Liefern, Käufe, Feldkopien);
              ohne klaren Nutzen → Zugende. Max. 12 Aktionen je Zug.
            </span>
          </label>
        </div>

        <div className="mc-actions">
          {progress.running ? (
            <button type="button" className="mc-pause" onClick={pause}>
              Pause
            </button>
          ) : progress.paused ? (
            <>
              <button type="button" className="mc-start" onClick={resume}>
                Fortsetzen (Seed {progress.nextSeed})
              </button>
              <button type="button" className="mc-start" onClick={start}>
                Neu ab Start-Seed
              </button>
            </>
          ) : (
            <button type="button" className="mc-start" onClick={start}>
              Simulation starten
            </button>
          )}
          <button
            type="button"
            className="ghost-btn"
            disabled={progress.running || results.length === 0}
            onClick={clearResults}
          >
            Ergebnisse löschen
          </button>
        </div>

        {(progress.running || progress.done > 0 || progress.paused) && (
          <div className="mc-progress">
            <div
              className={`mc-bar ${progress.running ? 'mc-bar-live' : ''}`}
              style={{ width: progress.running ? '100%' : '100%' }}
            />
            <span>
              {progress.done} Läufe
              {progress.running
                ? ` · läuft · nächster Seed ${progress.nextSeed}`
                : progress.paused
                  ? ` · pausiert · weiter ab ${progress.nextSeed}`
                  : ''}
              {results.length > 0 &&
                ` · ${finished}× Sieg · ${lost}× Niederlage`}
            </span>
          </div>
        )}
        {error && <p className="mc-error">{error}</p>}
        {persistError && (
          <p className="mc-error">Speicher: {persistError}</p>
        )}
      </section>

      <section className="mc-results">
        <div className="mc-results-head">
          <h2>
            Ergebnisse{' '}
            <em>
              ({rows.length}
              {rows.length !== results.length ? ` / ${results.length}` : ''})
            </em>
          </h2>
          <div className="mc-filters">
            <fieldset className="mc-outcome-filter">
              <legend>Ergebnis</legend>
              <div className="mc-outcome-checks">
                {ALL_OUTCOMES.map((o) => {
                  const checked = filters.outcomes.includes(o)
                  return (
                    <label key={o} className="mc-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? filters.outcomes.filter((x) => x !== o)
                            : [...filters.outcomes, o]
                          setFilters({ outcomes: next })
                        }}
                      />
                      {OUTCOME_LABEL[o]}
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <label>
              min. Verm. max
              <input
                type="number"
                placeholder="—"
                value={filters.minWealth ?? ''}
                onChange={(e) =>
                  setFilters({
                    minWealth:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Seed enthält
              <input
                type="text"
                value={filters.querySeed}
                onChange={(e) => setFilters({ querySeed: e.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="mc-table-wrap">
          <table className="mc-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.tip}>
                    <button
                      type="button"
                      title={c.tip}
                      onClick={() => setSort(c.key)}
                    >
                      {c.label}
                      {sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="mc-empty">
                    {progress.running
                      ? 'Läuft…'
                      : 'Noch keine Ergebnisse — starten und so lange laufen lassen wie nötig.'}
                  </td>
                </tr>
              )}
              {pageRows.map((r) => (
                <tr
                  key={r.seed}
                  className={`outcome-${r.outcome}${opening === r.seed ? ' opening' : ''}`}
                  onClick={() => void openRun(r)}
                  title={r.winnerText ?? 'Im Zeitstrahl öffnen'}
                >
                  <td>{r.seed}</td>
                  <td>{OUTCOME_LABEL[r.outcome]}</td>
                  <td>{r.leader}</td>
                  <td>{r.wealthMax}</td>
                  <td>{r.wealthMin}</td>
                  <td>{r.bankClaims}</td>
                  <td>{r.productions}</td>
                  <td>{r.productsDelivered}</td>
                  <td>{r.marketCollapses}</td>
                  <td>{r.sourceCollapses}</td>
                  <td>{r.marketsSpawned}</td>
                  <td>{r.marketIncome}</td>
                  <td>{r.feesPaidToPlayers}</td>
                  <td>{r.feesPaidToBank}</td>
                  <td>{r.privateBusinesses}</td>
                  <td>{r.fieldsBought ?? 0}</td>
                  <td>{r.actions}</td>
                  <td>{r.turns}</td>
                  <td>{r.bankLeft}</td>
                  <td>{r.durationMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="mc-pager">
            <label className="mc-pager-size">
              pro Seite
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </label>
            <span className="mc-pager-range">
              {safePage * pageSize + 1}–
              {Math.min((safePage + 1) * pageSize, rows.length)} von {rows.length}
            </span>
            <div className="mc-pager-nav">
              <button
                type="button"
                className="ghost-btn"
                disabled={safePage <= 0}
                onClick={() => setPage(0)}
              >
                «
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={safePage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ‹
              </button>
              <span className="mc-pager-page">
                Seite {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="ghost-btn"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                ›
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(pageCount - 1)}
              >
                »
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
