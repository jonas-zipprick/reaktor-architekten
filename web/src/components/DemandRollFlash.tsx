import { useEffect, useState } from 'react'
import type { GameState } from '../types'
import './DemandRollFlash.css'

type DiceRoll = { rain: 0 | 1 | 2; market: 0 | 1 | 2 }

/**
 * Kurze Würfel-Animation am Zugende: Regen- und Markt-Würfel.
 */
export function DemandRollFlash({ game }: { game: GameState }) {
  const [visible, setVisible] = useState(false)
  const [roll, setRoll] = useState<DiceRoll | null>(null)
  const [detail, setDetail] = useState<string[] | null>(null)
  const seq = game.endTurnDiceSeq

  useEffect(() => {
    if (!seq || !game.endTurnDice) return
    setRoll(game.endTurnDice)
    setDetail(game.demandRollFlash)
    setVisible(true)
    const hide = window.setTimeout(() => setVisible(false), 2400)
    return () => window.clearTimeout(hide)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur seq
  }, [seq])

  if (!visible || !roll) return null

  const cls =
    roll.rain > 0 && roll.market > 0
      ? 'dice-both'
      : roll.market > 0
        ? 'dice-market'
        : roll.rain > 0
          ? 'dice-rain'
          : 'dice-none'

  return (
    <div
      className={`demand-flash turn-dice-flash ${cls}`}
      role="status"
      aria-live="polite"
    >
      <p className="demand-flash-title">
        Zugende-Würfel · Regen 0/1/1/1/2/2 · Markt 0/0/1/1/1/2
      </p>
      <div className="turn-dice-pair" aria-hidden>
        <div className="turn-dice">
          <span className="turn-dice-spin">🎲</span>
          <span className="turn-dice-face">
            {roll.rain === 0 ? '—' : roll.rain === 1 ? '💧' : '💧💧'}
          </span>
          <span className="turn-dice-caption">Regen {roll.rain}</span>
        </div>
        <div className="turn-dice">
          <span className="turn-dice-spin">🎲</span>
          <span className="turn-dice-face">
            {roll.market === 0 ? '—' : roll.market === 1 ? '🧺' : '🧺🧺'}
          </span>
          <span className="turn-dice-caption">Markt {roll.market}</span>
        </div>
      </div>
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
