import type { MouseEvent } from 'react'
import type { FieldState, Recipe, Suit } from '../types'
import {
  isCommunalDepot,
  isMarketField,
  isOwnerOnlyField,
  isPersonalGarden,
  isSeedBed,
  isWaterTrade,
  MARKET_LEADING_MARKS,
  MARKET_METER_MARKS,
  outputRevealedCount,
  recipeSuits,
  suitCounts,
  suitName,
  suitSymbol,
  TENSION_MAX,
  TENSION_MIN,
  type MarketPrice,
} from '../types'
import { PLAYER_META } from '../data/scenarios'
import {
  harvestFieldScore,
  hasOutputStack,
  isFactoryBlocked,
  isVictoryColumnComplete,
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

export function DemandMeter({
  suit,
  value,
  flash = false,
  flashKey = 0,
  limitPulse = false,
}: {
  suit?: Suit
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
}) {
  const clamped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, value))
  const steps = TENSION_MAX - TENSION_MIN + 1
  const stoneIndex = clamped - TENSION_MIN
  const danger = value >= TENSION_MAX - 1
  const atMax = value >= TENSION_MAX
  const valueLabel = String(value)
  const name = suit ? suitName(suit) : 'Preis'

  return (
    <div
      key={flash ? `flash-${suit ?? 'x'}-${flashKey}` : `meter-${suit ?? 'x'}`}
      className={`tension-meter ${suit ? `suit-${suit}` : ''} ${danger ? 'danger' : ''} ${atMax ? 'surplus' : ''} ${flash ? 'demand-pulse' : ''} ${limitPulse ? 'limit-pulse' : ''}`}
      title={`${name}-Anzeige ${valueLabel}${atMax ? ` (Obergrenze ${TENSION_MAX})` : ''}`}
      aria-label={`${name}-Preisanzeige ${valueLabel}`}
    >
      <span className="tension-suit" aria-hidden>
        {suit ? suitSymbol(suit) : '·'}
      </span>
      <div
        className="tension-scale"
        style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}
      >
        {Array.from({ length: steps }, (_, i) => {
          const mark = TENSION_MIN + i
          const major = mark === TENSION_MIN || mark === 0 || mark === TENSION_MAX
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

function MarketMeterSegment({
  marks,
  value,
  flash = false,
  flashKey = 0,
  limitPulse = false,
  showSuit = false,
  className = '',
  dataPrice,
}: {
  marks: readonly number[]
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
  showSuit?: boolean
  className?: string
  dataPrice?: MarketPrice
}) {
  const clamped = Math.max(TENSION_MIN, Math.min(TENSION_MAX, value))
  const danger = value >= TENSION_MAX - 1
  const stoneIndex = marks.indexOf(clamped)
  const valueLabel = String(value)
  const inSegment = stoneIndex >= 0

  return (
    <div
      key={
        flash
          ? `flash-market-${dataPrice ?? 'lead'}-${flashKey}`
          : `meter-market-${dataPrice ?? 'lead'}`
      }
      className={[
        'tension-meter',
        'market-meter',
        'market-stall-meter',
        className,
        danger && inSegment ? 'danger' : '',
        flash ? 'demand-pulse' : '',
        limitPulse ? 'limit-pulse' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={`Markt-Preis ${valueLabel}${danger ? ` (Obergrenze ${TENSION_MAX})` : ''}`}
      aria-label={`Markt-Messwerte ${marks.join(', ')}`}
      data-price={dataPrice}
    >
      {showSuit && (
        <span className="tension-suit" aria-hidden>
          🧺
        </span>
      )}
      <div
        className="tension-scale"
        style={{ gridTemplateColumns: `repeat(${marks.length}, 1fr)` }}
      >
        {marks.map((mark) => (
          <span
            key={mark}
            className={[
              'tension-tick',
              mark === 0 || mark === TENSION_MAX ? 'major' : 'minor',
              mark === 0 ? 'zero' : '',
              mark >= TENSION_MAX - 1 ? 'collapse-near' : '',
              mark === clamped ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={String(mark)}
          >
            <i className="tension-line" aria-hidden />
            <em>{mark}</em>
          </span>
        ))}
        {stoneIndex >= 0 && (
          <span
            className="tension-stone"
            style={{
              left: `${((stoneIndex + 0.5) / marks.length) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Markt-Messwerte 0 und 1 links neben dem 2T-Stand (über keinem Feld).
 */
export function MarketZeroMeter({
  value,
  flash = false,
  flashKey = 0,
  limitPulse = false,
}: {
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
}) {
  return (
    <MarketMeterSegment
      marks={MARKET_LEADING_MARKS}
      value={value}
      flash={flash}
      flashKey={flashKey}
      limitPulse={limitPulse}
      showSuit
      className="market-zero-meter"
    />
  )
}

/**
 * Messabschnitt über einem Stand (2T: 2/3, 4T: 4/5, 6T: 6/7).
 */
export function MarketStallMeter({
  price,
  value,
  flash = false,
  flashKey = 0,
  limitPulse = false,
}: {
  price: MarketPrice
  value: number
  flash?: boolean
  flashKey?: number
  limitPulse?: boolean
}) {
  return (
    <MarketMeterSegment
      marks={MARKET_METER_MARKS[price]}
      value={value}
      flash={flash}
      flashKey={flashKey}
      limitPulse={limitPulse}
      dataPrice={price}
    />
  )
}

/** Rezept: welche Zutaten der Eingang annimmt. `anyOf` = ODER (Saatstand). */
function RecipePips({
  recipe,
  have,
  result,
  state,
  anyOf = false,
}: {
  recipe: Recipe
  have: Record<Suit, number>
  result?: Suit
  state: 'open' | 'blocked'
  anyOf?: boolean
}) {
  const used: Record<Suit, number> = {
    hearts: 0,
    energy: 0,
    clubs: 0,
    berry: 0,
    veg: 0,
    herb: 0,
  }
  const suits = recipeSuits(recipe)
  return (
    <div className={`recipe recipe-${state}${anyOf ? ' recipe-or' : ''}`}>
      {suits.map((suit, i) => {
        used[suit] += 1
        const filled = anyOf ? have[suit] > 0 : used[suit] <= have[suit]
        return (
          <span key={i} className="recipe-or-item">
            {anyOf && i > 0 && (
              <span className="recipe-or-sep" aria-hidden>
                /
              </span>
            )}
            <span
              className={`recipe-pip pip-${suit} ${filled ? 'filled' : ''}`}
            >
              {suitSymbol(suit)}
            </span>
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
      ? `Fertig 7→2 · ${n} Karten`
      : `${n} Karte${n === 1 ? '' : 'n'} · fertig erst mit 7→2 einer Sorte`
  }
  if (isMarketField(field)) {
    const price = field.marketPrice ?? 2
    const n = field.stack.length
    return `${price}T-Stand · ${n} Karte${n === 1 ? '' : 'n'} · Ernte & Saat · Entnahme: ${price}T an Ableger (eigene gratis) · Marktwurf: Preis +Würfel (1 oder 2), dann Kauf wenn Preis ≤ Anzeige`
  }
  if (hasOutputStack(field)) {
    const outs = field.outputs ?? []
    const outN = outs.reduce((s, o) => s + o.length, 0)
    const inN = field.stack.length
    const inLabel = isSeedBed(field)
      ? 'Ernte-Eingang'
      : isWaterTrade(field)
        ? 'Wasser-Eingang'
        : 'Eingang'
    const blocked = isFactoryBlocked(field) ? ' · Eingang blockiert' : ''
    const stacks =
      outs.length > 1 ? `${outs.length} Ausgabestapel, ` : 'Ausgabe '
    if (isPersonalGarden(field)) {
      return `${stacks}${outN} · ${inLabel} ${inN} · Zugende: bei Wasser+Saat Eingang→Ausgabe (kostenlos, nur Eigentümer)`
    }
    const demand = field.demand ?? 0
    const clearNote =
      'Eingang entnehmbar; Abrechnung + Leerung am Zugende'
    return `${stacks}${outN} · Preis ${demand} · ${inLabel} ${inN} (${clearNote})${blocked}`
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
    const rain = field.suit === 'energy'
    const parkRule = rain
      ? 'nur Wasser; Entnahme gratis; nur Eigentümer'
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
    isCommunalDepot(field) ||
    (field.kind === 'factory' && !isPersonalGarden(field))
  const dualStack = hasOutputStack(field)
  const isMarket = isMarketField(field)
  const isSource = field.kind === 'source' && !dualStack
  const isFactory = field.kind === 'factory'
  const ownerKey = field.owner ?? 'none'
  const have = suitCounts(field.stack)

  const recipeState: 'open' | 'blocked' =
    isFactory && isFactoryBlocked(field) ? 'blocked' : 'open'

  const personalOnly = isOwnerOnlyField(field)
  const hasOwner = Boolean(field.owner && field.owner !== 'state')
  const outputs = field.outputs ?? []
  const title = [
    field.label,
    hasOwner || personalOnly
      ? `Eigentümer: ${ownerName(field.owner)}`
      : 'Gemeinschaftsfläche',
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
        dualStack ? 'has-dual-stack' : '',
        isMarket ? 'market-stall' : '',
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
              title={`Eigentümer: ${ownerName(field.owner)}`}
            >
              {field.owner !== 'state'
                ? (PLAYER_META[field.owner]?.short ?? '·')
                : '·'}
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
            anyOf={isSeedBed(field)}
          />
        )}

        {isSource && field.suit && !field.recipe && (
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
            const sp = complete ? harvestFieldScore(field) : 0
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
                  Ernte{complete ? ` ✓ ${sp}SP` : ''}
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
          <div className="cell-body market-stall-body">
            <div className="cell-stack">
              {field.stack
                .slice(Math.max(0, field.stack.length - INPUT_VISIBLE))
                .map((card, i, visible) => {
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
              {field.stack.length === 0 && (
                <span className="stack-empty-hint">ablegen</span>
              )}
              {field.stack.length > 1 && (
                <span
                  className="stack-count"
                  title={`${field.stack.length} Karten`}
                >
                  {field.stack.length}
                </span>
              )}
            </div>
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
