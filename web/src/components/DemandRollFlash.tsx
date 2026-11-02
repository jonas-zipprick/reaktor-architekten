import { useEffect, useState } from 'react'
import type { GameState } from '../types'
import './DemandRollFlash.css'

export function DemandRollFlash({ game }: { game: GameState }) {
  const [visible, setVisible] = useState(false)
  const [text, setText] = useState<string[] | null>(null)
  const seq = game.demandRollSeq

  useEffect(() => {
    // Nur bei neuer Würfelung (seq), nicht bei jedem State-Clone (z. B. Gebühr ändern).
    if (!seq || !game.demandRollFlash?.length) return
    setText(game.demandRollFlash)
    setVisible(true)
    const hide = window.setTimeout(() => setVisible(false), 1800)
    return () => window.clearTimeout(hide)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur seq
  }, [seq])

  if (!visible || !text) return null

  return (
    <div className="demand-flash" role="status" aria-live="polite">
      <p className="demand-flash-title">Bedarf gewürfelt</p>
      <ul>
        {text.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="demand-flash-vp">+1◆</p>
    </div>
  )
}
