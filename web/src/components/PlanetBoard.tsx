import { CRITICAL_LIMIT } from '../data/boardLayout'
import { formatMeter, METER_LABELS, playerLabel } from '../data/labels'
import { planetHue } from '../data/planetNames'
import { hexKey } from '../hex/math'
import { useGame } from '../state/gameStore'
import type { CellState, MeterKind } from '../types'
import './PlanetBoard.css'

const METER_ORDER: MeterKind[] = ['voltage', 'water', 'heat']

/** Visual bar from the centre (0) toward ±CRITICAL_LIMIT. */
function MeterTrack({ value }: { value: number }) {
  const clamped = Math.max(-CRITICAL_LIMIT, Math.min(CRITICAL_LIMIT, value))
  const pct = (Math.abs(clamped) / CRITICAL_LIMIT) * 50
  const left = clamped < 0 ? 50 - pct : 50
  const critical = Math.abs(value) >= CRITICAL_LIMIT
  return (
    <div className="meter-track" aria-hidden>
      <span
        className={`meter-fill ${clamped < 0 ? 'is-negative' : ''} ${critical ? 'is-critical' : ''}`}
        style={{ left: `${left}%`, width: `${pct}%` }}
      />
    </div>
  )
}

function byName(a: CellState, b: CellState): number {
  return (a.planetName ?? '').localeCompare(b.planetName ?? '', 'de')
}

function planetGroups(cells: Record<string, CellState>): {
  id: '1' | '2' | 'neutral'
  label: string
  planets: CellState[]
}[] {
  const planets = Object.values(cells).filter(
    (c) => c.revealed && c.terrain === 'planet',
  )
  return [
    {
      id: '1',
      label: 'Weiß',
      planets: planets.filter((p) => p.planetOwner === 1).sort(byName),
    },
    {
      id: '2',
      label: 'Schwarz',
      planets: planets.filter((p) => p.planetOwner === 2).sort(byName),
    },
    {
      id: 'neutral',
      label: 'Neutral',
      planets: planets.filter((p) => p.planetOwner == null).sort(byName),
    },
  ].filter((group) => group.planets.length > 0)
}

export function PlanetBoard() {
  const cells = useGame((s) => s.cells)
  const selectedHex = useGame((s) => s.selectedHex)
  const selectHex = useGame((s) => s.selectHex)
  const adjustMeter = useGame((s) => s.adjustMeter)
  const groups = planetGroups(cells)
  const planetCount = groups.reduce((n, group) => n + group.planets.length, 0)

  return (
    <aside className="planet-board" aria-label="Planeten-Nebenspielfeld">
      <header className="planet-board-head">
        <h2>Planeten</h2>
        <span className="muted">{planetCount}</span>
      </header>
      {planetCount === 0 ? (
        <p className="planet-board-empty">Noch keine Planeten entdeckt.</p>
      ) : (
        <div className="planet-groups">
          {groups.map((group) => (
            <section
              key={group.id}
              className={`planet-group owner-${group.id}`}
              aria-label={group.label}
            >
              <h3 className="planet-group-head">
                <span className="planet-group-mark" aria-hidden />
                {group.label}
                <span className="muted">{group.planets.length}</span>
              </h3>
              <ul className="planet-board-list">
                {group.planets.map((planet) => {
            const selected =
              selectedHex &&
              selectedHex.q === planet.hex.q &&
              selectedHex.r === planet.hex.r
            const critical = METER_ORDER.some(
              (m) =>
                planet[m] <= -CRITICAL_LIMIT || planet[m] >= CRITICAL_LIMIT,
            )
            const hue = planetHue(planet.planetName)
            return (
              <li key={hexKey(planet.hex)}>
                <button
                  type="button"
                  className={`planet-card owner-${group.id} ${selected ? 'is-selected' : ''} ${critical ? 'is-critical' : ''}`}
                  onClick={() => selectHex(planet.hex)}
                  style={{ ['--planet-hue' as string]: hue }}
                >
                  <div className="planet-card-top">
                    <span className="planet-glyph" aria-hidden />
                    <div className="planet-card-title">
                      <strong className="planet-card-name">
                        {planet.planetName ?? 'Unbenannt'}
                      </strong>
                      <span className="planet-card-meta">
                        ({planet.hex.q},{planet.hex.r})
                        {planet.planetOwner ? (
                          <span
                            className={`owner-tag owner-${planet.planetOwner}`}
                          >
                            {playerLabel(planet.planetOwner)}
                          </span>
                        ) : (
                          ' · neutral'
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="planet-meters-panel">
                    {METER_ORDER.map((meter) => (
                      <div key={meter} className="planet-meter-row">
                        <span className="planet-meter-label">
                          {METER_LABELS[meter]}
                        </span>
                        <MeterTrack value={planet[meter]} />
                        <div className="stepper planet-meter-stepper">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              adjustMeter(planet.hex, meter, -1)
                            }}
                            aria-label={`${METER_LABELS[meter]} −`}
                          >
                            −
                          </button>
                          <strong
                            className={
                              planet[meter] <= -CRITICAL_LIMIT ||
                              planet[meter] >= CRITICAL_LIMIT
                                ? 'is-critical'
                                : undefined
                            }
                          >
                            {formatMeter(planet[meter])}
                          </strong>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              adjustMeter(planet.hex, meter, 1)
                            }}
                            aria-label={`${METER_LABELS[meter]} +`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="planet-dice-row">
                    <span className="muted">W4</span>
                    {planet.consumers.length === 0 ? (
                      <span className="planet-dice-empty">—</span>
                    ) : (
                      <div className="planet-dice-list">
                        {planet.consumers.map((c) => (
                          <span
                            key={c.id}
                            className={`planet-die die-${c.type}`}
                            title={`${METER_LABELS[c.type]} · Genehmiger ${playerLabel(c.approver)}`}
                          >
                            {METER_LABELS[c.type]}
                            <em>{playerLabel(c.approver)}</em>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  )
}
