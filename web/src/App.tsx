import { Board } from './components/Board'
import { DemandRollFlash } from './components/DemandRollFlash'
import { PlanetLimitFlash } from './components/PlanetLimitFlash'
import { ScenarioPicker } from './components/ScenarioPicker'
import { SidePanel } from './components/SidePanel'
import { useGameStore } from './state/gameStore'
import './App.css'

export default function App() {
  const phase = useGameStore((s) => s.phase)
  const game = useGameStore((s) => s.game)

  if (phase === 'menu' || !game) {
    return <ScenarioPicker />
  }

  return (
    <div className="app-shell">
      <div className="play-layout">
        <main className="board-area">
          <DemandRollFlash game={game} />
          <PlanetLimitFlash game={game} />
          <Board game={game} />
        </main>
        <SidePanel game={game} />
      </div>
    </div>
  )
}
