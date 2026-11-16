import type { Card, Suit } from '../types'
import { rankLabel, suitName, suitSymbol } from '../types'
import { PLAYER_META } from '../data/scenarios'
import './PlayingCard.css'

const suitRole: Record<Suit, string> = {
  hearts: 'Ernte',
  energy: 'Rohstoff',
  clubs: 'Ware',
  berry: 'Ware',
  veg: 'Ware',
  herb: 'Ware',
}

export function PlayingCard({
  card,
  compact = false,
  stacked = false,
  highlight = false,
  stackIndex = 0,
  faceDown = false,
  dimmed = false,
}: {
  card: Card
  compact?: boolean
  stacked?: boolean
  highlight?: boolean
  /** Higher index paints above lower cards in a stack. */
  stackIndex?: number
  /** Verdeckt (Nachziehstapel): Rücken in der Farbe des Decks. */
  faceDown?: boolean
  /** Nicht zugängliche Karte unter der obersten (Quellen). */
  dimmed?: boolean
}) {
  const sizeClass = `${compact ? 'compact' : ''} ${stacked ? 'stacked' : ''}`

  if (faceDown) {
    return (
      <div
        className={`pcard back back-${card.suit} ${sizeClass}`}
        style={{ zIndex: stackIndex }}
        aria-label={`Verdeckte ${suitName(card.suit)}-Karte`}
      />
    )
  }

  const name = `${suitName(card.suit)} ${rankLabel(card.rank)}`
  const placer = card.marketPlacedBy
    ? PLAYER_META[card.marketPlacedBy]
    : null
  const title = [
    name,
    suitRole[card.suit],
    placer ? `Besitz: ${placer.name}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={`pcard suit-${card.suit} ${sizeClass} ${highlight ? 'highlight' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ zIndex: stackIndex }}
      aria-label={placer ? `${name}, Besitz ${placer.name}` : name}
      title={title}
    >
      <span className="pcard-edge">
        <span className="pcard-edge-rank">{rankLabel(card.rank)}</span>
        <span className="pcard-edge-icon" aria-hidden>
          {suitSymbol(card.suit)}
        </span>
      </span>
      <span className="pcard-rank">{rankLabel(card.rank)}</span>
      {placer && (
        <span
          className="pcard-owner"
          style={{ background: placer.color }}
          aria-hidden
        />
      )}
    </div>
  )
}
