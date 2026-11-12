import { useEffect, useState } from 'react'
import type { GameState } from '../types'
import './PlanetLimitFlash.css'

export function PlanetLimitFlash({ game }: { game: GameState }) {
  const [visible, setVisible] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const seq = game.planetLimitSeq

  useEffect(() => {
    if (!seq || !game.planetLimitFlash) return
    setText(game.planetLimitFlash)
    setVisible(true)
    const hide = window.setTimeout(() => setVisible(false), 1800)
    return () => window.clearTimeout(hide)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur seq
  }, [seq])

  if (!visible || !text) return null

  const isSource = /\d+ Karten/.test(text)
  const isSpawn = text.includes('→') && !/\d+ Karten/.test(text)
  const withFactory = isSpawn && /fabrik/i.test(text)

  return (
    <div className="planet-limit-flash" role="status" aria-live="polite">
      <p className="planet-limit-flash-title">
        {isSpawn
          ? withFactory
            ? 'Markt & Fabrik'
            : 'Neuer Markt'
          : isSource
            ? 'Quelle kollabiert'
            : 'Markt kollabiert'}
      </p>
      <p className="planet-limit-flash-body">{text}</p>
      <p className="planet-limit-flash-note">
        {isSpawn
          ? 'Exp-Zähler voll · Gemeinschaftsfläche'
          : isSource
            ? 'Stapel weg'
            : 'Messer 0 · Exp-Zähler zurück'}
      </p>
    </div>
  )
}
