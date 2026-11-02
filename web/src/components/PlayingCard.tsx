import type { Card, Suit } from '../types'
import { rankLabel } from '../types'
import './PlayingCard.css'

export type DefenseAllegiance = 'own' | 'enemy' | 'neutral'

const suitMeta: Record<
  Suit,
  { className: string; icon: string; label: string }
> = {
  hearts: { className: 'role-energy', icon: '✦', label: 'Energie' },
  clubs: { className: 'role-demand', icon: '◎', label: 'Bedarf' },
  spades: { className: 'role-defense', icon: '⬡', label: 'Verteidigung' },
  diamonds: { className: 'role-offense', icon: '▲', label: 'Angriff' },
}

export function PlayingCard({
  card,
  compact = false,
  stacked = false,
  highlight = false,
  stackIndex = 0,
  defenseAllegiance,
}: {
  card: Card
  compact?: boolean
  stacked?: boolean
  highlight?: boolean
  /** Higher index paints above lower cards in a stack. */
  stackIndex?: number
  /** Only for spades on the board: own / enemy / neutral look. */
  defenseAllegiance?: DefenseAllegiance
}) {
  if (!card.faceUp) {
    return (
      <div
        className={`pcard back ${compact ? 'compact' : ''} ${stacked ? 'stacked' : ''}`}
        style={{ zIndex: stackIndex }}
        aria-label="Verdeckte Karte"
      />
    )
  }

  const meta = suitMeta[card.suit]
  const defenseClass =
    card.suit === 'spades' && defenseAllegiance
      ? `defense-${defenseAllegiance}`
      : ''

  const label =
    card.suit === 'spades' && defenseAllegiance === 'neutral'
      ? 'Neutrale Verteidigung'
      : card.suit === 'spades' && defenseAllegiance === 'enemy'
        ? 'Fremde Verteidigung'
        : card.suit === 'spades' && defenseAllegiance === 'own'
          ? 'Eigene Verteidigung'
          : meta.label

  return (
    <div
      className={`pcard ${meta.className} ${defenseClass} ${compact ? 'compact' : ''} ${stacked ? 'stacked' : ''} ${highlight ? 'highlight' : ''}`}
      style={{ zIndex: stackIndex }}
      aria-label={`${label} ${rankLabel(card.rank)}`}
      title={`${label} ${rankLabel(card.rank)}`}
    >
      <span className="pcard-edge">
        <span className="pcard-edge-rank">{rankLabel(card.rank)}</span>
        <span className="pcard-edge-icon" aria-hidden>
          {meta.icon}
        </span>
      </span>
      <span className="pcard-rank">{rankLabel(card.rank)}</span>
    </div>
  )
}
