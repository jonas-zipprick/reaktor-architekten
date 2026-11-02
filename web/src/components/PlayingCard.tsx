import type { Card } from '../types'
import { rankLabel, suitSymbol } from '../types'
import './PlayingCard.css'

const suitClass: Record<Card['suit'], string> = {
  hearts: 'suit-hearts',
  clubs: 'suit-clubs',
  spades: 'suit-spades',
  diamonds: 'suit-diamonds',
}

export function PlayingCard({
  card,
  compact = false,
  stacked = false,
  highlight = false,
}: {
  card: Card
  compact?: boolean
  stacked?: boolean
  highlight?: boolean
}) {
  if (!card.faceUp) {
    return (
      <div
        className={`pcard back ${compact ? 'compact' : ''} ${stacked ? 'stacked' : ''}`}
        aria-label="Verdeckte Karte"
      />
    )
  }

  return (
    <div
      className={`pcard ${suitClass[card.suit]} ${compact ? 'compact' : ''} ${stacked ? 'stacked' : ''} ${highlight ? 'highlight' : ''}`}
      aria-label={`${suitSymbol(card.suit)}${rankLabel(card.rank)}`}
    >
      <span className="pcard-rank">{rankLabel(card.rank)}</span>
      <span className="pcard-suit">{suitSymbol(card.suit)}</span>
    </div>
  )
}
