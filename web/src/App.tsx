import { HexBoard } from './components/HexBoard'
import { PlanetBoard } from './components/PlanetBoard'
import { SidePanel } from './components/SidePanel'
import { useHotkeys } from './hooks/useHotkeys'
import { useGame } from './state/gameStore'
import './App.css'

export default function App() {
  useHotkeys()
  const discardHeldChip = useGame((s) => s.removeChip)

  function onStageClick() {
    const id = useGame.getState().selectedChipId
    if (id) discardHeldChip(id)
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
          <span className="leg">Fog: Chip fliegt weiter</span>
          <span className="leg">Asteroid / Wand → Beutel</span>
          <span className="leg owner-1">Schiff Weiß</span>
          <span className="leg owner-2">Schiff Schwarz</span>
        </footer>
      </div>
      <SidePanel />
    </div>
  )
}
