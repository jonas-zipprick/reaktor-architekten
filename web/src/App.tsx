import { useEffect, type MouseEvent } from 'react'
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

/** Flächen ohne eigene Aktion: weißes Brett, beiger Tisch, Leerraum der Seitenleiste. */
const EMPTY_SURFACE =
  '.board-area, .board-viewport, .board-shell, .board-grid, .board-discards, .side-panel'

const KEEPS_SELECTION =
  'button, a, input, select, textarea, label, .balance-card, .stat, .action-box, .market-box, .log-box, .end-box, .toll-box, .side-essentials, .side-money, .timeline, .auction-backdrop, .historic-banner'

function isEmptySurfaceTap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(KEEPS_SELECTION)) return false
  return Boolean(target.closest(EMPTY_SURFACE))
}

export default function App() {
  const phase = useGameStore((s) => s.phase)
  const game = useGameStore((s) => s.game)
  const isHistoric = useGameStore((s) => s.isHistoric)
  const auction = useGameStore((s) => s.auction)
  const clearSelection = useGameStore((s) => s.clearSelection)

  const onEmptyTap = (e: MouseEvent<HTMLDivElement>) => {
    if (!isEmptySurfaceTap(e.target)) return
    clearSelection()
  }

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
      <div
        className={`play-layout ${isHistoric ? 'historic-view' : ''}`}
        onClick={onEmptyTap}
      >
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
