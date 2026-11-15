import type { MouseEvent } from 'react'
import type { FieldState, Recipe, Suit } from '../types'
import {
  hasOwnership,
  isMarketField,
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
  hasOutputStack,
  isFactoryBlocked,
  isVictoryColumnComplete,
  marketInputStacks,
  type MoveCheck,
} from '../state/rules'
import { PlayingCard } from './PlayingCard'
import './BoardCell.css'

/** So viele Karten einer Quelle/Ausgabe/Eingang werden aufgefächert; der Rest steckt im Zähler. */
const SOURCE_VISIBLE = 7
const OUTPUT_VISIBLE = 6
const INPUT_VISIBLE = 6

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
  market = false,
}: {
  suit?: Suit
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
  market?: boolean
}) {
  const clamped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, value))
  const steps = TENSION_MAX - TENSION_MIN + 1
  const stoneIndex = clamped - TENSION_MIN
  const danger = value <= TENSION_MIN + 1
  const surplus = value > OVERSUPPLY_COLLAPSE
  const valueLabel = String(value)
  const name = market ? 'Markt' : suit ? suitName(suit) : 'Bedarf'
  const surplusNote = market
    ? ' (Überversorgung → Extra-Eingang)'
    : ' (Überversorgung → Extra-Stapel)'

  return (
    <div
      key={flash ? `flash-${suit ?? 'market'}-${flashKey}` : `meter-${suit ?? 'market'}`}
      className={`tension-meter ${market ? 'market-meter' : ''} ${suit ? `suit-${suit}` : ''} ${danger ? 'danger' : ''} ${surplus ? 'surplus' : ''} ${flash ? 'demand-pulse' : ''} ${limitPulse ? 'limit-pulse' : ''}`}
      title={`${name}-Bedarf ${valueLabel}${surplus ? surplusNote : danger ? ' (Unterversorgung → weg)' : ''}`}
      aria-label={`${name}-Bedarfsmesser ${valueLabel}`}
    >
      <span className="tension-suit" aria-hidden>
        {market ? '🧺' : suit ? suitSymbol(suit) : '·'}
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
  if (field.kind === 'victory') {
    const n = field.stack.length
    const done = isVictoryColumnComplete(field.stack)
    return done
      ? `Sortiert · ${n} Karte${n === 1 ? '' : 'n'}`
      : `${n} Karte${n === 1 ? '' : 'n'} · nimmt Mehl, Obst und Konfitüre`
  }
  if (isMarketField(field)) {
    const inputs = marketInputStacks(field)
    const inN = inputs.reduce((s, col) => s + col.length, 0)
    const demand = field.demand ?? 0
    const stacks =
      inputs.length > 1 ? `${inputs.length} Eingänge` : 'Eingang'
    return `${stacks} · ${inN} Karte${inN === 1 ? '' : 'n'} · Bedarf ${demand} · Zugende: je Karte auszahlen/+1, leeren, dann −1`
  }
  if (hasOutputStack(field)) {
    const outs = field.outputs ?? []
    const outN = outs.reduce((s, o) => s + o.length, 0)
    const demand = field.demand ?? 0
    const inN = field.stack.length
    const inLabel = isSeedBed(field) ? 'Obst-Eingang' : 'Eingang'
    const blocked = isFactoryBlocked(field) ? ' · Eingang blockiert' : ''
    const stacks =
      outs.length > 1 ? `${outs.length} Ausgabestapel, ` : 'Ausgabe '
    const clearNote =
      'Eingang entnehmbar; Abrechnung + Leerung am Zugende'
    return `${stacks}${outN} · Bedarf ${demand} · ${inLabel} ${inN} (${clearNote})${blocked}`
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
  if (field.kind === 'source') {
    const n = field.stack.length
    const isRegen = field.suit === 'energy'
    const parkRule = isRegen
      ? 'Ausgabe: nur Wasser ablegen; Entnahme gratis'
      : 'Ablage jeder Sorte; Entnahme gratis'
    if (!n) return `Leer — wächst nach · ${parkRule}`
    return `${n} Karte${n === 1 ? '' : 'n'} · ${parkRule}`
  }
  return 'Nur die oberste Karte ist zugänglich'
}

export function BoardCell({
  field,
  selected,
  selectedLane = null,
  selectedStackIndex = 0,
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
  selectedStackIndex?: number
  selectedCount?: number
  target: MoveCheck | null
  demandFlash?: boolean
  demandFlashKey?: number
  limitFlash?: boolean
  limitFlashKey?: number
  produced?: boolean
  onClick: (
    e: MouseEvent,
    lane?: 'input' | 'output',
    stackIndex?: number,
  ) => void
}) {
  const isMeterField =
    field.kind === 'factory' || isSeedBed(field) || isMarketField(field)
  const dualStack = hasOutputStack(field)
  const isMarket = isMarketField(field)
  const isSource = field.kind === 'source' && !dualStack
  const isFactory = field.kind === 'factory'
  const ownerKey = field.owner ?? 'none'
  const have = suitCounts(field.stack)
  const marketInputs = isMarket ? marketInputStacks(field) : []

  const recipeState: 'open' | 'blocked' =
    isFactory && isFactoryBlocked(field) ? 'blocked' : 'open'

  const personalOnly = hasOwnership(field.kind)
  const hasOwner = Boolean(field.owner && field.owner !== 'state')
  const outputs = field.outputs ?? []
  const title = [
    field.label,
    hasOwner || personalOnly
      ? `Eigentümer: ${ownerName(field.owner)}`
      : 'Gemeinschaftsfläche',
    hasOwner && field.kind !== 'storage' ? `Gebühr ${field.fee}¤` : null,
    statusLine(field),
  ]
    .filter(Boolean)
    .join('\n')

  // Quelle: nur oberste Karten sichtbar.
  const sourceHidden = isSource
    ? Math.max(0, field.stack.length - SOURCE_VISIBLE)
    : 0
  const sourceVisible = isSource ? field.stack.slice(sourceHidden) : []

  const inHidden = Math.max(0, field.stack.length - INPUT_VISIBLE)
  const inVisible = dualStack ? field.stack.slice(inHidden) : []

  return (
    <button
      type="button"
      className={[
        'board-cell',
        `kind-${field.kind}`,
        field.suit ? `suit-${field.suit}` : '',
        field.kind === 'victory' ? 'kind-victory' : '',
        hasOwner || personalOnly ? `owner-${ownerKey}` : 'owner-none',
        selected ? 'selected' : '',
        target ? 'is-target' : '',
        produced ? 'just-produced' : '',
        dualStack || (isMarket && marketInputs.length > 1)
          ? 'has-dual-stack'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-field={field.id}
      onClick={(e) => {
        const node = e.target as HTMLElement | null
        const stackEl = node?.closest('[data-stack-index]') as HTMLElement | null
        const idx = stackEl
          ? Number(stackEl.dataset.stackIndex ?? 0)
          : 0
        if (dualStack) {
          if (node?.closest('.factory-input')) onClick(e, 'input', idx)
          else if (node?.closest('.factory-output')) onClick(e, 'output', idx)
          else onClick(e, 'output', idx)
          return
        }
        if (isMarket) {
          onClick(e, 'input', idx)
          return
        }
        onClick(e)
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
              {field.owner !== 'state'
                ? (PLAYER_META[field.owner]?.short ?? '·')
                : '·'}
              {field.kind !== 'storage' ? ` ${field.fee}¤` : ''}
            </span>
          )}
        </div>

        {isMeterField && field.demand != null && (field.suit || isMarket) && (
          <div className="planet-meters">
            <DemandMeter
              suit={field.suit}
              value={field.demand}
              flash={demandFlash || limitFlash}
              flashKey={demandFlashKey + limitFlashKey * 1000}
              limitPulse={limitFlash}
              market={isMarket}
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

        {field.kind === 'victory' ? (
          (() => {
            const col = field.stack
            const hidden = Math.max(0, col.length - INPUT_VISIBLE)
            const visible = col.slice(hidden)
            const complete = isVictoryColumnComplete(col)
            return (
              <div
                className={[
                  'factory-input',
                  'victory-column',
                  selected ? 'lane-selected' : '',
                  complete ? 'victory-column-complete' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="stack-lane-label">
                  Ernte{complete ? ' ✓' : ''}
                </span>
                <div className="cell-stack input-stack">
                  {visible.map((card, i) => {
                    const fromTop = visible.length - 1 - i
                    const inSelection = selected && fromTop < selectedCount
                    return (
                      <PlayingCard
                        key={card.id}
                        card={card}
                        compact
                        stacked={i > 0}
                        stackIndex={i}
                        highlight={inSelection}
                        dimmed={!inSelection && fromTop > 0 && selected}
                      />
                    )
                  })}
                  {col.length === 0 && (
                    <span className="stack-empty-hint">ablegen</span>
                  )}
                  {col.length > 1 && (
                    <span
                      className="stack-count stack-count-input"
                      title={`${col.length} Karten`}
                    >
                      {col.length}
                    </span>
                  )}
                </div>
              </div>
            )
          })()
        ) : isMarket ? (
          <div className="factory-stacks market-inputs">
            {(marketInputs.length ? marketInputs : [[]]).map((col, mi) => {
              const hidden = Math.max(0, col.length - INPUT_VISIBLE)
              const visible = col.slice(hidden)
              const laneSelected =
                selected && selectedStackIndex === mi
              const label =
                marketInputs.length > 1 ? `Eingang ${mi + 1}` : 'Eingang'
              return (
                <div
                  key={`market-in-${mi}`}
                  className={[
                    'factory-input',
                    laneSelected ? 'lane-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-stack-index={mi}
                >
                  <span className="stack-lane-label">{label}</span>
                  <div className="cell-stack input-stack">
                    {visible.map((card, i) => {
                      const fromTop = visible.length - 1 - i
                      const inSelection =
                        laneSelected && fromTop < selectedCount
                      return (
                        <PlayingCard
                          key={card.id}
                          card={card}
                          compact
                          stacked={i > 0}
                          stackIndex={i}
                          highlight={inSelection}
                          dimmed={!inSelection && fromTop > 0 && laneSelected}
                        />
                      )
                    })}
                    {col.length === 0 && (
                      <span className="stack-empty-hint">ablegen</span>
                    )}
                    {col.length > 1 && (
                      <span
                        className="stack-count stack-count-input"
                        title={`${col.length} Karten (entnehmbar)`}
                      >
                        {col.length}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : dualStack ? (
          <div className="factory-stacks">
            <div
                className={[
                  'factory-input',
                  selected && selectedLane === 'input' ? 'lane-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-stack-index={0}
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
                        dimmed={
                          !inSelection &&
                          fromTop > 0 &&
                          selected &&
                          selectedLane === 'input'
                        }
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
            <div className="factory-outputs">
              {(outputs.length ? outputs : [[]]).map((output, oi) => {
                const outHidden = Math.max(0, output.length - OUTPUT_VISIBLE)
                const outVisible = output.slice(outHidden)
                const outRevealed = outputRevealedCount(field, oi)
                const outSelected =
                  selected &&
                  selectedLane === 'output' &&
                  selectedStackIndex === oi
                const outLabel =
                  outputs.length > 1 ? `Ausgabe ${oi + 1}` : 'Ausgabe'
                return (
                  <div
                    key={`out-${oi}`}
                    className={[
                      'factory-output',
                      outSelected ? 'lane-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    data-stack-index={oi}
                  >
                    <span className="stack-lane-label">{outLabel}</span>
                    <div className="cell-stack source-stack">
                      {outVisible.map((card, i) => {
                        const fromTop = outVisible.length - 1 - i
                        const faceDown = fromTop >= outRevealed
                        const inSelection =
                          outSelected && !faceDown && fromTop < selectedCount
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
                )
              })}
            </div>
          </div>
        ) : (
          <div
            className={[
              'stack-slot',
              isSource && field.suit === 'energy'
                ? 'factory-output regen-output'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
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
            </div>
          </div>
        )}

        {target && (
          <div className="target-badge">
            {target.cost > 0 ? `−${target.cost}¤` : 'frei'}
            {target.kind === 'feed' &&
              target.income > 0 && <strong> +{target.income}¤</strong>}
            {target.kind === 'claim' && <strong> Ernte</strong>}
            {target.kind === 'market' && <strong> Markt</strong>}
          </div>
        )}
      </div>
    </button>
  )
}
