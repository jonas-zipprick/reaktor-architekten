import type { MouseEvent } from 'react'
import type { FieldState, Recipe, Suit } from '../types'
import {
  hasOwnership,
  recipeSuits,
  suitCounts,
  suitName,
  suitSymbol,
  TENSION_MAX,
  TENSION_MIN,
} from '../types'
import { PLAYER_META } from '../data/scenarios'
import {
  describeCard,
  factoryHasOutput,
  factoryProduct,
  isFactoryBlocked,
  isProductionReady,
  plannedProductions,
  type MoveCheck,
} from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './BoardCell.css'

/** So viele Karten einer Quelle werden aufgefächert; der Rest steckt im Zähler. */
const SOURCE_VISIBLE = 7

function ownerName(owner: FieldState['owner']): string {
  if (!owner) return 'herrenlos'
  if (owner === 'state') return 'Staat'
  return PLAYER_META[owner].name
}

function DemandMeter({
  suit,
  value,
  flash = false,
  flashKey = 0,
  limitPulse = false,
}: {
  suit: Suit
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
}) {
  const clamped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, value))
  const steps = TENSION_MAX - TENSION_MIN + 1
  const stoneIndex = clamped - TENSION_MIN
  const danger = clamped <= TENSION_MIN + 1
  const valueLabel = String(clamped)
  const name = suitName(suit)

  return (
    <div
      key={flash ? `flash-${suit}-${flashKey}` : `meter-${suit}`}
      className={`tension-meter suit-${suit} ${danger ? 'danger' : ''} ${flash ? 'demand-pulse' : ''} ${limitPulse ? 'limit-pulse' : ''}`}
      title={`${name}-Bedarf ${valueLabel}`}
      aria-label={`${name}-Bedarfsmesser ${valueLabel}`}
    >
      <span className="tension-suit" aria-hidden>
        {suitSymbol(suit)}
      </span>
      <div
        className="tension-scale"
        style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}
      >
        {Array.from({ length: steps }, (_, i) => {
          const mark = TENSION_MIN + i
          const major =
            mark === TENSION_MIN || mark === 0 || mark === TENSION_MAX
          return (
            <span
              key={mark}
              className={[
                'tension-tick',
                major ? 'major' : 'minor',
                mark === 0 ? 'zero' : '',
                mark === clamped ? 'active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <i className="tension-line" aria-hidden />
              <em>{mark}</em>
            </span>
          )
        })}
        <span
          className="tension-stone"
          style={{
            // Mitte der aktiven Tick-Spalte (nicht Rand-zu-Rand).
            left: `${((stoneIndex + 0.5) / steps) * 100}%`,
          }}
        />
      </div>
      <span className="tension-value">{valueLabel}</span>
    </div>
  )
}

/** Rezept als Farbsymbole; bereits liegende Karten füllen die Symbole. */
function RecipePips({
  recipe,
  have,
  result,
  state,
  batches = 0,
}: {
  recipe: Recipe
  have: Record<Suit, number>
  /** Fabrik: Farbe des Fertigprodukts. */
  result?: Suit
  state: 'open' | 'ready' | 'blocked'
  /** Geplante Produktionen bei Zugende (≥1 wenn ready). */
  batches?: number
}) {
  const used: Record<Suit, number> = {
    hearts: 0,
    spades: 0,
    energy: 0,
    diamonds: 0,
    clubs: 0,
  }
  return (
    <div className={`recipe recipe-${state}`}>
      {recipeSuits(recipe).map((suit, i) => {
        used[suit] += 1
        const filled = used[suit] <= have[suit]
        return (
          <span
            key={i}
            className={`recipe-pip pip-${suit} ${filled ? 'filled' : ''}`}
          >
            {suitSymbol(suit)}
          </span>
        )
      })}
      {result && (
        <>
          <span className="recipe-arrow" aria-hidden>
            →
          </span>
          <span className={`recipe-pip pip-${result} filled`}>
            {suitSymbol(result)}
          </span>
          {batches > 1 && (
            <span className="recipe-batches" title={`${batches} Produkte`}>
              ×{batches}
            </span>
          )}
        </>
      )}
    </div>
  )
}

function statusLine(field: FieldState): string {
  if (field.kind === 'factory') {
    if (factoryHasOutput(field)) {
      const n = field.stack.length
      if (!factoryProduct(field)) {
        return `${n} Karte${n === 1 ? '' : 'n'} — Ablage auf Fertigware; Produkt darunter`
      }
      return n === 1
        ? 'Produkt bereit — Ablage jeder Farbe erlaubt'
        : `${n} Produkte bereit — Ablage jeder Farbe erlaubt`
    }
    const batches = plannedProductions(field)
    if (batches > 0) {
      return batches === 1
        ? 'Produktionsbereit (1 Produkt am Zugende)'
        : `Produktionsbereit (${batches} Produkte am Zugende)`
    }
    if (isFactoryBlocked(field)) return 'Rezept nicht mehr erfüllbar'
    return 'Wartet auf Rohstoffe'
  }
  if (field.kind === 'storage') {
    return field.stack.length
      ? 'Lager zum Umsortieren'
      : 'Leeres Lager — jede zulässige Karte darf hier liegen'
  }
  if (field.kind === 'market' && field.demand != null && field.suit) {
    return `Markt ${suitSymbol(field.suit)} Bedarf ${field.demand}`
  }
  if (field.kind === 'source') {
    const n = field.stack.length
    if (n > 8) return `${n} Karten — Kollaps (Ablage jeder Farbe)`
    if (n >= 7) return `${n} Karten (Kollaps ab 9; Ablage jeder Farbe)`
    if (!n) return 'Leer — zieht nach; Ablage jeder Farbe erlaubt'
    return `${n} Karte${n === 1 ? '' : 'n'} — Ablage jeder Farbe; Kollaps ab 9`
  }
  return 'Nur die oberste Karte ist zugänglich'
}

export function BoardCell({
  field,
  selected,
  selectedCount = 0,
  target,
  demandFlash = false,
  demandFlashKey = 0,
  limitFlash = false,
  limitFlashKey = 0,
  produced = false,
  onClick,
}: {
  field: FieldState
  selected: boolean
  /** Bei Auswahl: wie viele Karten von oben markiert sind. */
  selectedCount?: number
  /** Gebühren/Einkommen, falls dieses Feld ein legales Ziel der Auswahl ist. */
  target: MoveCheck | null
  demandFlash?: boolean
  demandFlashKey?: number
  limitFlash?: boolean
  limitFlashKey?: number
  /** Fabrik hat bei der letzten Zieh- und Produktionsaktion produziert. */
  produced?: boolean
  onClick: (e: MouseEvent) => void
}) {
  const isMeterField = field.kind === 'market'
  const isSource = field.kind === 'source'
  const ownerKey = field.owner ?? 'none'
  const have = suitCounts(field.stack)

  const recipeState: 'open' | 'ready' | 'blocked' =
    field.kind === 'factory'
      ? isProductionReady(field)
        ? 'ready'
        : isFactoryBlocked(field)
          ? 'blocked'
          : 'open'
      : 'open'

  // Quellen: nur die oberste Karte ist zugänglich, darunter eng gefächert.
  const hidden = isSource
    ? Math.max(0, field.stack.length - SOURCE_VISIBLE)
    : 0
  const visibleCards = field.stack.slice(hidden)

  const owned = hasOwnership(field.kind)
  const title = [
    field.label,
    owned ? `Eigentümer: ${ownerName(field.owner)}` : 'Gemeinschaftsfläche',
    owned && field.owner ? `Gebühr ${field.fee}¤` : null,
    statusLine(field),
    field.stack.length
      ? `Stapel (unten → oben): ${field.stack.map(describeCard).join(' ')}`
      : 'Stapel leer',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <button
      type="button"
      className={[
        'board-cell',
        `kind-${field.kind}`,
        field.suit ? `suit-${field.suit}` : '',
        owned ? `owner-${ownerKey}` : 'owner-none',
        selected ? 'selected' : '',
        target ? 'is-target' : '',
        produced ? 'just-produced' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-field={field.id}
      onClick={onClick}
      title={title}
      aria-label={
        owned ? `${field.label}, ${ownerName(field.owner)}` : field.label
      }
    >
      <div className="cell-glow" aria-hidden />
      <div className="cell-frame">
        <div className="cell-meta">
          <span className="cell-kind">{field.label}</span>
          {owned &&
            (field.owner ? (
              <span
                className={`cell-toll toll-${ownerKey}`}
                title={`${ownerName(field.owner)} · Gebühr ${field.fee}¤`}
              >
                {field.fee}¤
              </span>
            ) : (
              <span className="cell-toll toll-none" title="Herrenlos">
                frei
              </span>
            ))}
        </div>

        {isMeterField && field.demand != null && field.suit && (
          <div className="planet-meters">
            <DemandMeter
              suit={field.suit}
              value={field.demand}
              flash={demandFlash || limitFlash}
              flashKey={demandFlashKey + limitFlashKey * 1000}
              limitPulse={limitFlash}
            />
          </div>
        )}

        {field.recipe && (
          <RecipePips
            recipe={field.recipe}
            have={have}
            result={field.kind === 'factory' ? field.suit : undefined}
            state={recipeState}
            batches={
              field.kind === 'factory' ? plannedProductions(field) : 0
            }
          />
        )}

        {isSource && field.suit && (
          <div className="recipe recipe-open">
            <span className={`recipe-pip pip-${field.suit} filled`}>
              {suitSymbol(field.suit)}
            </span>
            <span className="source-caption">{suitName(field.suit)}-Rohstoff</span>
          </div>
        )}

        <div className={`cell-stack ${isSource ? 'source-stack' : ''}`}>
          {visibleCards.map((card, i) => {
            const fromTop = visibleCards.length - 1 - i
            const inSelection = selected && fromTop < selectedCount
            return (
              <PlayingCard
                key={card.id}
                card={card}
                compact
                stacked={i > 0}
                stackIndex={i}
                highlight={inSelection}
                dimmed={isSource && !inSelection && fromTop > 0}
              />
            )
          })}
          {isSource && field.stack.length > 1 && (
            <span
              className="stack-count"
              title={`${field.stack.length} Karten im Vorrat`}
            >
              {field.stack.length}
            </span>
          )}
        </div>

        {target && (
          <div className="target-badge">
            {target.cost > 0 ? `−${target.cost}¤` : 'frei'}
            {target.kind === 'deliver' && target.income > 0 && (
              <strong> +{target.income}¤</strong>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
