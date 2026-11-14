import { useEffect } from 'react'
import { AuctionDialog } from './components/AuctionDialog'
import { Board } from './components/Board'
import { DemandRollFlash } from './components/DemandRollFlash'
import { MonteCarloPage } from './components/MonteCarloPage'
import { MoveFlight } from './components/MoveFlight'
import { PlanetLimitFlash } from './components/PlanetLimitFlash'
import { ScenarioPicker } from './components/ScenarioPicker'
import { SidePanel } from './components/SidePanel'
import { Timeline } from './components/Timeline'
import { applyRouteFromLocation, useGameStore } from './state/gameStore'
import './App.css'

export default function App() {
  const phase = useGameStore((s) => s.phase)
  const game = useGameStore((s) => s.game)
  const isHistoric = useGameStore((s) => s.isHistoric)
  const auction = useGameStore((s) => s.auction)

  useEffect(() => {
    applyRouteFromLocation()
    const onPop = () => applyRouteFromLocation()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (phase === 'menu') {
    return <ScenarioPicker />
  }

  if (phase === 'montecarlo') {
    return <MonteCarloPage />
  }

  if (!game) {
    return <ScenarioPicker />
  }

  return (
    <div className="app-shell">
      <div className={`play-layout ${isHistoric ? 'historic-view' : ''}`}>
        <main className="board-area">
          {isHistoric && (
            <div className="historic-banner" role="status">
              Historischer Stand — neuer Zug verwirft spätere Aktionen
            </div>
          )}
          <DemandRollFlash game={game} />
          <PlanetLimitFlash game={game} />
          <Board game={game} />
          <MoveFlight />
        </main>
        <SidePanel game={game} />
      </div>
      <Timeline />
      {auction && <AuctionDialog key={auction.fieldId} game={game} />}
    </div>
  )
}
