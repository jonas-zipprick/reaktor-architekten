import { useEffect, useState } from 'react'
import type { Card, FieldId } from '../types'
import { PlayingCard } from './PlayingCard'
import { useGameStore } from '../state/gameStore'
import './MoveFlight.css'

type Pos = { x: number; y: number }

function fieldCenter(id: FieldId): Pos | null {
  const el = document.querySelector(`[data-field="${CSS.escape(id)}"]`)
  if (!(el instanceof HTMLElement)) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function polylineLength(pts: Pos[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x
    const dy = pts[i]!.y - pts[i - 1]!.y
    len += Math.hypot(dx, dy)
  }
  return len
}

function pointAlong(pts: Pos[], dist: number): Pos {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1) return pts[0]!
  let left = dist
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (left <= seg || i === pts.length - 1) {
      const t = seg <= 0 ? 1 : Math.min(1, left / seg)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= seg
  }
  return pts[pts.length - 1]!
}

export function MoveFlight() {
  const moveAnim = useGameStore((s) => s.moveAnim)
  const finishMoveAnimation = useGameStore((s) => s.finishMoveAnimation)
  const [pos, setPos] = useState<Pos | null>(null)
  const [trail, setTrail] = useState<Pos[]>([])

  useEffect(() => {
    if (!moveAnim) {
      setPos(null)
      setTrail([])
      return
    }

    const pts = moveAnim.path
      .map(fieldCenter)
      .filter((p): p is Pos => p != null)
    if (pts.length < 1) {
      finishMoveAnimation()
      return
    }

    setPos(pts[0]!)
    setTrail([pts[0]!])

    const totalLen = Math.max(1, polylineLength(pts))
    // Teleportation: kurze Flugdauer, leicht abhängig von der Strecke.
    const duration = Math.min(520, Math.max(260, totalLen * 0.9))
    const t0 = performance.now()
    let raf = 0

    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / duration)
      // ease-in-out
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
      const p = pointAlong(pts, totalLen * e)
      setPos(p)
      setTrail((prev) => {
        const last = prev[prev.length - 1]
        if (last && Math.hypot(last.x - p.x, last.y - p.y) < 6) return prev
        return [...prev.slice(-24), p]
      })
      if (u < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        finishMoveAnimation()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [moveAnim, finishMoveAnimation])

  if (!moveAnim || !pos) return null

  const cards: Card[] = moveAnim.cards

  return (
    <div className="move-flight" aria-hidden>
      <svg className="move-flight-trail">
        {trail.length > 1 && (
          <polyline
            fill="none"
            stroke="rgba(240, 168, 48, 0.55)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={trail.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        )}
      </svg>
      <div
        className="move-flight-card"
        style={{
          left: pos.x,
          top: pos.y,
        }}
      >
        {cards.map((card, i) => (
          <PlayingCard
            key={card.id}
            card={card}
            compact
            stacked={i > 0}
            stackIndex={i}
          />
        ))}
      </div>
    </div>
  )
}
