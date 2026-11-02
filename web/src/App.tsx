import { Board } from './components/Board'
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
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <strong>Versorgungs-Architekten</strong>
            <span>
              Szenario {game.scenarioId} · {game.mode}
            </span>
          </div>
        </div>
        <div className="top-meta">
          <span className="pill">Zug {game.turn}</span>
          <span className="pill money">{game.bank}¤ Bank</span>
          <span className="pill">{game.demandDeck.length} Bedarf</span>
        </div>
      </header>

      <div className="play-layout">
        <main className="board-area">
          <Board game={game} />
        </main>
        <SidePanel game={game} />
      </div>
    </div>
  )
}
