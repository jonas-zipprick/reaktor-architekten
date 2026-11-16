import { useEffect, useState } from 'react'
import type { GameState } from '../types'
import './DemandRollFlash.css'

type DiceFace = 'rain' | 'market' | 'both'

/**
 * Kurze Würfel-Animation am Zugende: 2× Regen / 2× Markt / 2× beides.
 */
export function DemandRollFlash({ game }: { game: GameState }) {
  const [visible, setVisible] = useState(false)
  const [face, setFace] = useState<DiceFace | null>(null)
  const [detail, setDetail] = useState<string[] | null>(null)
  const seq = game.endTurnDiceSeq

  useEffect(() => {
    if (!seq || !game.endTurnDice) return
    setFace(game.endTurnDice)
    setDetail(game.demandRollFlash)
    setVisible(true)
    const hide = window.setTimeout(() => setVisible(false), 2200)
    return () => window.clearTimeout(hide)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur seq
  }, [seq])

  if (!visible || !face) return null

  const meta =
    face === 'rain'
      ? { label: 'Regen', symbol: '💧', cls: 'dice-rain' }
      : face === 'market'
        ? { label: 'Markt', symbol: '🧺', cls: 'dice-market' }
        : { label: 'Regen & Markt', symbol: '💧🧺', cls: 'dice-both' }

  return (
    <div
      className={`demand-flash turn-dice-flash ${meta.cls}`}
      role="status"
      aria-live="polite"
    >
      <p className="demand-flash-title">
        Zugende-Würfel · 2× Regen / 2× Markt / 2× beides
      </p>
      <div className="turn-dice" aria-hidden>
        <span className="turn-dice-spin">🎲</span>
        <span className="turn-dice-face">{meta.symbol}</span>
      </div>
      <p className="turn-dice-label">{meta.label}</p>
      {detail && detail.length > 1 && (
        <ul>
          {detail.slice(1).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
