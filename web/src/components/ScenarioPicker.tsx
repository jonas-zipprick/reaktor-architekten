import { useState } from 'react'
import {
  DIFFICULTY_BLURBS,
  DIFFICULTY_LABELS,
  missionForDifficulty,
  type Difficulty,
} from '../data/difficulty'
import {
  GAME_MODE_BLURBS,
  GAME_MODE_LABELS,
  scenariosForMode,
} from '../data/scenarios'
import { axialToPixel, cornersToPath, hexCorners } from '../hex/math'
import { useGame } from '../state/gameStore'
import type { GameMode } from '../types'
import './ScenarioPicker.css'

const PREVIEW_SIZE = 8
const MODES: GameMode[] = ['solo', 'coop', 'versus']
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'extreme']

function ScenarioSilhouette({
  cells,
}: {
  cells: { q: number; r: number }[]
}) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const faces = cells.map((hex) => {
    const { x, y } = axialToPixel(hex, PREVIEW_SIZE)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    return { x, y, d: cornersToPath(hexCorners(x, y, PREVIEW_SIZE * 0.92)) }
  })
  const pad = PREVIEW_SIZE * 1.2
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2
  const ox = -minX + pad
  const oy = -minY + pad
  return (
    <svg
      className="scenario-silhouette"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <g transform={`translate(${ox} ${oy})`}>
        {faces.map((face, i) => (
          <path key={i} d={face.d} className="scenario-silhouette-hex" />
        ))}
      </g>
    </svg>
  )
}

function modeSeatLabel(mode: GameMode, playerCount: number): string {
  if (mode === 'solo') return '1 Spieler'
  if (mode === 'coop') return '2 Spieler'
  return `${playerCount} Spieler`
}

export function ScenarioPicker() {
  const startScenario = useGame((s) => s.startScenario)
  const [mode, setMode] = useState<GameMode>('versus')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const scenarios = scenariosForMode(mode)
  const missionMode = mode === 'solo' || mode === 'coop'

  return (
    <div className="scenario-picker">
      <header className="scenario-picker-head">
        <p className="scenario-eyebrow">Playtest</p>
        <h1>Modus & Szenario</h1>
        <p className="scenario-lead">
          Solo und Koop: Mission mit Freibeutern. Versus: reichstes Vermögen bei
          leerer Bank.
        </p>
      </header>

      <div className="mode-tabs" role="tablist" aria-label="Spielmodus">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`mode-tab ${mode === m ? 'is-active' : ''}`}
            onClick={() => setMode(m)}
          >
            <span className="mode-tab-name">{GAME_MODE_LABELS[m]}</span>
            <span className="mode-tab-blurb">{GAME_MODE_BLURBS[m]}</span>
          </button>
        ))}
      </div>

      {missionMode && (
        <div
          className="difficulty-tabs"
          role="tablist"
          aria-label="Schwierigkeit"
        >
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={difficulty === d}
              className={`difficulty-tab ${difficulty === d ? 'is-active' : ''}`}
              onClick={() => setDifficulty(d)}
            >
              <span className="difficulty-tab-name">
                {DIFFICULTY_LABELS[d]}
              </span>
              <span className="difficulty-tab-blurb">
                {DIFFICULTY_BLURBS[d]}
              </span>
            </button>
          ))}
        </div>
      )}

      <ul className="scenario-grid">
        {scenarios.map((scenario) => {
          const raw = missionMode ? scenario.missions?.[mode] : undefined
          const mission = raw
            ? missionForDifficulty(raw, difficulty)
            : undefined
          return (
            <li key={scenario.id} className="scenario-card">
              <ScenarioSilhouette cells={scenario.cells} />
              <div className="scenario-card-body">
                <h2>{scenario.name}</h2>
                <p className="scenario-meta">
                  {modeSeatLabel(mode, scenario.playerCount)} · {scenario.focus}
                </p>
                <p className="scenario-blurb">{scenario.blurb}</p>
                {mission && (
                  <p className="scenario-mission">
                    Mission ({DIFFICULTY_LABELS[difficulty]}):{' '}
                    {mission.planets
                      .map(
                        (p) =>
                          `${p.planetName} (${p.needByRound8.join(' + ')})`,
                      )
                      .join(' · ')}{' '}
                    · {mission.rounds} Runden
                    {scenario.freibeuters && scenario.freibeuters.length > 0
                      ? ` · ${mode === 'solo' ? 1 : scenario.freibeuters.length} Freibeuter`
                      : ''}
                  </p>
                )}
                <button
                  type="button"
                  className="btn scenario-start"
                  onClick={() =>
                    startScenario(
                      scenario.id,
                      mode,
                      missionMode ? difficulty : 'normal',
                    )
                  }
                >
                  {GAME_MODE_LABELS[mode]} starten
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
