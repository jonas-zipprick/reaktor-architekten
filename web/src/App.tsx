import type { MouseEvent } from 'react'
import { HexBoard } from './components/HexBoard'
import { PlanetBoard } from './components/PlanetBoard'
import { ScenarioPicker } from './components/ScenarioPicker'
import { SidePanel } from './components/SidePanel'
import { playerLabel } from './data/labels'
import { useAiDriver } from './hooks/useAi'
import { useHotkeys } from './hooks/useHotkeys'
import { useGame } from './state/gameStore'
import './App.css'

export default function App() {
  useHotkeys()
  useAiDriver()
  const phase = useGame((s) => s.phase)
  const playerIds = useGame((s) => s.playerIds)

  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('.planet-board, .board-dock, button, a, input, textarea, select, label')) {
      return
    }
    const state = useGame.getState()
    state.selectHex(null)
    state.selectChip(null)
  }

  if (phase === 'setup') {
    return (
      <div className="app-shell">
        <ScenarioPicker />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="stage" onClick={onStageClick}>
        <div className="stage-atmosphere" aria-hidden />
        <div className="board-row">
          <HexBoard />
          <PlanetBoard />
        </div>
        <footer className="board-legend">
          <span className="leg chip-blue">Blau 1 W</span>
          <span className="leg chip-purple">Lila 2 W</span>
          <span className="leg chip-red">Rot 3 W</span>
          <span className="leg">Asteroid → Beutel</span>
          {playerIds.map((p) => (
            <span key={p} className={`leg owner-${p}`}>
              Schiff {playerLabel(p)}
            </span>
          ))}
        </footer>
      </div>
      <SidePanel />
    </div>
  )
}
