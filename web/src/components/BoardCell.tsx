import type { MouseEvent } from 'react'
import type { FieldState, Recipe, Suit } from '../types'
import {
  hasOwnership,
  isSeedBed,
  outputRevealedCount,
  recipeSuits,
  suitCounts,
  suitName,
  suitSymbol,
  OVERSUPPLY_COLLAPSE,
  TENSION_MAX,
  TENSION_MIN,
} from '../types'
import { PLAYER_META } from '../data/scenarios'
import {
  describeCard,
  hasOutputStack,
  isFactoryBlocked,
  type MoveCheck,
} from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './BoardCell.css'

/** So viele Karten einer Quelle/Ausgabe werden aufgefächert; der Rest steckt im Zähler. */
const SOURCE_VISIBLE = 7
const OUTPUT_VISIBLE = 5
const INPUT_VISIBLE = 4

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
  const danger = value <= TENSION_MIN + 1
  const surplus = value > OVERSUPPLY_COLLAPSE
  const canExpand = value > 0
  const valueLabel = String(value)
  const name = suitName(suit)

  return (
    <div
      key={flash ? `flash-${suit}-${flashKey}` : `meter-${suit}`}
      className={`tension-meter suit-${suit} ${danger ? 'danger' : ''} ${surplus ? 'surplus' : ''} ${flash ? 'demand-pulse' : ''} ${limitPulse ? 'limit-pulse' : ''}`}
      title={`${name}-Bedarf ${valueLabel}${surplus ? ' (Überversorgung → weg)' : canExpand ? ' (Kopie käuflich)' : danger ? ' (Unterversorgung → weg)' : ''}`}
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
            left: `${((stoneIndex + 0.5) / steps) * 100}%`,
          }}
        />
      </div>
      <span className="tension-value">{valueLabel}</span>
    </div>
  )
}

/** Rezept: welche Zutaten der Eingang annimmt. */
function RecipePips({
  recipe,
  have,
  result,
  state,
}: {
  recipe: Recipe
  have: Record<Suit, number>
  result?: Suit
  state: 'open' | 'blocked'
}) {
  const used: Record<Suit, number> = {
    hearts: 0,
    spades: 0,
    energy: 0,
    diamonds: 0,
    clubs: 0,
    steel: 0,
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
        </>
      )}
    </div>
  )
}

function statusLine(field: FieldState): string {
  if (hasOutputStack(field)) {
    const out = field.output?.length ?? 0
    const demand = field.demand ?? 0
    const inN = field.stack.length
    const inLabel = isSeedBed(field) ? 'Obst-Eingang' : 'Eingang'
    const blocked = isFactoryBlocked(field) ? ' · Eingang blockiert' : ''
    const clearNote =
      'Eingang entnehmbar; Abrechnung + Leerung am Zugende'
    return `Ausgabe ${out} · Bedarf ${demand} · ${inLabel} ${inN} (${clearNote})${blocked}`
  }
  if (field.kind === 'storage') {
    if (field.suit) {
      const name = suitName(field.suit)
      return field.stack.length
        ? `Nur ${name} — Umsortieren`
        : `Leer — nimmt nur ${name}`
    }
    return field.stack.length
      ? 'Schuppen zum Umsortieren (jede Sorte; nur Eigentümer)'
      : 'Leerer Schuppen — jede Sorte; nur Eigentümer'
  }
  if (field.kind === 'market' && field.demand != null && field.suit) {
    return `Stand ${suitSymbol(field.suit)} Bedarf ${field.demand} · Eingang entnehmbar; Abrechnung + Leerung am Zugende`
  }
  if (field.kind === 'source') {
    const n = field.stack.length
    const isRegen = field.suit === 'energy'
    const parkRule = isRegen
      ? 'Ausgabe: nur Wasser ablegen; Entnahme gratis'
      : 'Ablage jeder Sorte; Entnahme gratis'
    if (n > 8)
      return `${n} Karten — Überernte droht am Zugende · ${parkRule}`
    if (!n) return `Leer — wächst nach · ${parkRule}`
    return `${n} Karte${n === 1 ? '' : 'n'} · ${parkRule}; Überernte am Zugende ab 9`
  }
  return 'Nur die oberste Karte ist zugänglich'
}

export function BoardCell({
  field,
  selected,
  selectedLane = null,
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
  /** Bei Küche/Saatstand: welche Spur ausgewählt ist. */
  selectedLane?: 'input' | 'output' | null
  selectedCount?: number
  target: MoveCheck | null
  demandFlash?: boolean
  demandFlashKey?: number
  limitFlash?: boolean
  limitFlashKey?: number
  produced?: boolean
  onClick: (e: MouseEvent, lane?: 'input' | 'output') => void
}) {
  const isMeterField =
    field.kind === 'market' || field.kind === 'factory' || isSeedBed(field)
  const dualStack = hasOutputStack(field)
  const isSource = field.kind === 'source' && !dualStack
  const isFactory = field.kind === 'factory'
  const ownerKey = field.owner ?? 'none'
  const have = suitCounts(field.stack)

  const recipeState: 'open' | 'blocked' =
    isFactory && isFactoryBlocked(field) ? 'blocked' : 'open'

  const personalOnly = hasOwnership(field.kind)
  const hasOwner = Boolean(field.owner && field.owner !== 'state')
  const output = field.output ?? []
  const title = [
    field.label,
    hasOwner || personalOnly
      ? `Eigentümer: ${ownerName(field.owner)}`
      : 'Gemeinschaftsfläche',
    hasOwner && field.kind !== 'storage' ? `Gebühr ${field.fee}¤` : null,
    statusLine(field),
    dualStack
      ? `Ausgabe (${output.length}): ${
          output.length
            ? describeCard(output[output.length - 1]!)
            : 'leer'
        }`
      : null,
    field.stack.length
      ? `${
          dualStack || field.kind === 'market'
            ? 'Eingang'
            : field.kind === 'source' && field.suit === 'energy'
              ? 'Ausgabe'
              : 'Stapel'
        } (unten → oben): ${field.stack.map(describeCard).join(' ')}`
      : dualStack || field.kind === 'market'
        ? 'Eingang leer'
        : field.kind === 'source' && field.suit === 'energy'
          ? 'Ausgabe leer'
          : 'Stapel leer',
  ]
    .filter(Boolean)
    .join('\n')

  // Quelle: nur oberste Karten sichtbar.
  const sourceHidden = isSource
    ? Math.max(0, field.stack.length - SOURCE_VISIBLE)
    : 0
  const sourceVisible = isSource ? field.stack.slice(sourceHidden) : []

  // Küche/Saatstand: Ausgabe (nur oben aufgedeckt) + Eingang (nur Ablegen).
  const outHidden = Math.max(0, output.length - OUTPUT_VISIBLE)
  const outVisible = output.slice(outHidden)
  // Einmal aufgedeckte Karten bleiben offen.
  const outRevealed = outputRevealedCount(field)
  const inHidden = Math.max(0, field.stack.length - INPUT_VISIBLE)
  const inVisible = dualStack ? field.stack.slice(inHidden) : []

  return (
    <button
      type="button"
      className={[
        'board-cell',
        `kind-${field.kind}`,
        field.suit ? `suit-${field.suit}` : '',
        hasOwner || personalOnly ? `owner-${ownerKey}` : 'owner-none',
        selected ? 'selected' : '',
        target ? 'is-target' : '',
        produced ? 'just-produced' : '',
        dualStack ? 'has-dual-stack' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-field={field.id}
      onClick={(e) => {
        if (!dualStack) {
          onClick(e)
          return
        }
        const node = e.target as HTMLElement | null
        if (node?.closest('.factory-input')) onClick(e, 'input')
        else if (node?.closest('.factory-output')) onClick(e, 'output')
        else onClick(e, 'output')
      }}
      title={title}
      aria-label={
        hasOwner || personalOnly
          ? `${field.label}, ${ownerName(field.owner)}`
          : field.label
      }
    >
      <div className="cell-glow" aria-hidden />
      <div className="cell-frame">
        <div className="cell-meta">
          <span className="cell-kind">{field.label}</span>
          {hasOwner && field.owner && (
            <span
              className={`cell-toll toll-${ownerKey}`}
              title={`Eigentümer: ${ownerName(field.owner)}${field.kind !== 'storage' ? ` · Gebühr ${field.fee}¤` : ''}`}
            >
              {PLAYER_META[field.owner]?.short ?? '·'}
              {field.kind !== 'storage' ? ` ${field.fee}¤` : ''}
            </span>
          )}
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
            result={dualStack ? field.suit : undefined}
            state={recipeState}
          />
        )}

        {isSource && field.suit && (
          <div className="recipe recipe-open">
            <span className={`recipe-pip pip-${field.suit} filled`}>
              {suitSymbol(field.suit)}
            </span>
            <span className="source-caption">{suitName(field.suit)}</span>
          </div>
        )}

        {field.kind === 'storage' && field.suit && (
          <div className="recipe recipe-open">
            <span className={`recipe-pip pip-${field.suit} filled`}>
              {suitSymbol(field.suit)}
            </span>
            <span className="source-caption">nur {suitName(field.suit)}</span>
          </div>
        )}

        {dualStack ? (
          <div className="factory-stacks">
            <div
              className={[
                'factory-input',
                selected && selectedLane === 'input' ? 'lane-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="stack-lane-label">Eingang</span>
              <div className="cell-stack input-stack">
                {inVisible.map((card, i) => {
                  const fromTop = inVisible.length - 1 - i
                  const inSelection =
                    selected &&
                    selectedLane === 'input' &&
                    fromTop < selectedCount
                  return (
                    <PlayingCard
                      key={card.id}
                      card={card}
                      compact
                      stacked={i > 0}
                      stackIndex={i}
                      highlight={inSelection}
                      dimmed={!inSelection && fromTop > 0 && selected && selectedLane === 'input'}
                    />
                  )
                })}
                {field.stack.length === 0 && (
                  <span className="stack-empty-hint">ablegen</span>
                )}
                {field.stack.length > 1 && (
                  <span
                    className="stack-count stack-count-input"
                    title={`${field.stack.length} Karten im Eingang (entnehmbar)`}
                  >
                    {field.stack.length}
                  </span>
                )}
              </div>
            </div>
            <div
              className={[
                'factory-output',
                selected && selectedLane === 'output' ? 'lane-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="stack-lane-label">Ausgabe</span>
              <div className="cell-stack source-stack">
                {outVisible.map((card, i) => {
                  const fromTop = outVisible.length - 1 - i
                  const faceDown = fromTop >= outRevealed
                  const inSelection =
                    selected &&
                    selectedLane === 'output' &&
                    !faceDown &&
                    fromTop < selectedCount
                  return (
                    <PlayingCard
                      key={card.id}
                      card={card}
                      compact
                      stacked={i > 0}
                      stackIndex={i}
                      highlight={inSelection}
                      faceDown={faceDown}
                      dimmed={!faceDown && !inSelection && fromTop > 0}
                    />
                  )
                })}
                {output.length === 0 && (
                  <span className="stack-empty-hint">leer</span>
                )}
                {output.length > 1 && (
                  <span
                    className="stack-count"
                    title={`${output.length} Karten in der Ausgabe`}
                  >
                    {output.length}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            className={[
              'stack-slot',
              field.kind === 'market' ? 'factory-input market-input' : '',
              isSource && field.suit === 'energy'
                ? 'factory-output regen-output'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {field.kind === 'market' && (
              <span className="stack-lane-label">Eingang</span>
            )}
            {isSource && field.suit === 'energy' && (
              <span className="stack-lane-label">Ausgabe</span>
            )}
            <div className={`cell-stack ${isSource ? 'source-stack' : ''}`}>
              {(isSource ? sourceVisible : field.stack).map((card, i) => {
                const stack = isSource ? sourceVisible : field.stack
                const fromTop = stack.length - 1 - i
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
              {field.kind === 'market' && field.stack.length === 0 && (
                <span className="stack-empty-hint">ablegen</span>
              )}
              {isSource && field.stack.length > 1 && (
                <span
                  className="stack-count"
                  title={
                    field.suit === 'energy'
                      ? `${field.stack.length} Karten in der Ausgabe`
                      : `${field.stack.length} Karten im Vorrat`
                  }
                >
                  {field.stack.length}
                </span>
              )}
              {field.kind === 'market' && field.stack.length > 1 && (
                <span
                  className="stack-count stack-count-input"
                  title={`${field.stack.length} Karten im Eingang (entnehmbar)`}
                >
                  {field.stack.length}
                </span>
              )}
            </div>
          </div>
        )}

        {target && (
          <div className="target-badge">
            {target.cost > 0 ? `−${target.cost}¤` : 'frei'}
            {(target.kind === 'deliver' || target.kind === 'feed') &&
              target.income > 0 && <strong> +{target.income}¤</strong>}
          </div>
        )}
      </div>
    </button>
  )
}
