import {
  getScenario,
  personalBeetLabel,
  PLAYER_META,
  playersFor,
  ROW,
} from '../data/scenarios'
import type {
  Card,
  DeckState,
  FieldState,
  GameState,
  PlayerState,
  Rank,
  ScenarioId,
  Suit,
} from '../types'
import {
  hasOwnership,
  isSeedBed,
  MARKET_FIELD_ID,
  SEED_BED_RECIPE,
  SUITS,
  VICTORY_COLUMN_COUNT,
  victoryFieldId,
} from '../types'
import { createRng, shuffle } from './rng'

const RANKS: Rank[] = [7, 6, 5, 4, 3, 2]

/** Eindeutige ID-Präfixe (suit[0] kollidiert bei spades/steel). */
const SUIT_ID_PREFIX: Record<Suit, string> = {
  hearts: 'h',
  spades: 's',
  energy: 'e',
  diamonds: 'd',
  clubs: 'c',
  steel: 't',
}

const START_CARDS_PER_SOURCE = 2
/** Küchen-/Saatstand-Ausgabe: Start- und Nachfüllgröße. */
export const FACTORY_OUTPUT_SIZE = 10
const START_MONEY = 5
/** Große Bank — leere Bank beendet die Partie nicht. */
const BANK_START = 2000

/** Decks: `total` Karten gleichmäßig über die Ränge 7…2. */
function buildDeck(suit: Suit, total: number, rng: () => number): Card[] {
  const cards: Card[] = []
  let n = 0
  const prefix = SUIT_ID_PREFIX[suit]
  const base = Math.floor(total / RANKS.length)
  let rem = total % RANKS.length
  for (const rank of RANKS) {
    const count = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem -= 1
    for (let i = 0; i < count; i++) {
      n += 1
      cards.push({
        id: `${prefix}${n}`,
        suit,
        rank,
      })
    }
  }
  return shuffle(cards, rng)
}

function takeOutputCards(
  decks: Record<Suit, DeckState>,
  suit: Suit,
  count: number,
): Card[] {
  const out: Card[] = []
  for (let n = 0; n < count; n++) {
    const card = decks[suit]!.draw.pop()
    if (!card) break
    out.push(card)
  }
  return out
}

export function createGame(
  scenarioId: ScenarioId,
  seed = Date.now(),
): GameState {
  const rng = createRng(seed)
  const scenario = getScenario(scenarioId)
  const playerIds = playersFor(scenarioId)

  const decks = {} as Record<Suit, DeckState>
  for (const suit of SUITS) {
    decks[suit] = {
      draw: buildDeck(suit, scenario.cardsPerSuit, rng),
      discard: [],
    }
  }

  const fields: Record<string, FieldState> = {}
  for (const f of scenario.fields) {
    // Infrastruktur kommt persönlich je Spieler — nicht aus dem Szenario-Feldkatalog.
    if (hasOwnership(f.kind)) continue
    const field: FieldState = {
      id: f.id,
      kind: f.kind,
      label: f.label,
      suit: f.suit,
      recipe: f.recipe,
      row: f.row,
      fee: 0,
      stack: [],
    }
    if (f.kind === 'factory' && f.suit) {
      field.demand = 0
      const out = takeOutputCards(decks, f.suit, FACTORY_OUTPUT_SIZE)
      field.outputs = [out]
      field.outputsRevealed = [out.length > 0 ? 1 : 0]
    }
    if (f.kind === 'source' && f.suit) {
      if (isSeedBed(f)) {
        // Saatstand: endloser Saat-Ausgang, Obst-Eingang, Bedarfsmesser bei 0.
        field.demand = 0
        field.recipe = SEED_BED_RECIPE
        const out = takeOutputCards(decks, f.suit, FACTORY_OUTPUT_SIZE)
        field.outputs = [out]
        field.outputsRevealed = [out.length > 0 ? 1 : 0]
      } else {
        for (let n = 0; n < START_CARDS_PER_SOURCE; n++) {
          const card = decks[f.suit]!.draw.pop()
          if (card) field.stack.push(card)
        }
      }
    }
    fields[f.id] = field
  }

  const multi = playerIds.length > 1
  for (const playerId of playerIds) {
    const id = `lager-${playerId}-1`
    fields[id] = {
      id,
      kind: 'storage',
      label: personalBeetLabel(playerId, undefined, multi),
      row: ROW.storage,
      owner: playerId,
      fee: 0,
      stack: [],
    }
    for (let i = 0; i < VICTORY_COLUMN_COUNT; i++) {
      const base =
        VICTORY_COLUMN_COUNT > 1 ? `Ernte ${i + 1}` : 'Ernte'
      const label = multi ? `${PLAYER_META[playerId].short}·${base}` : base
      const id = victoryFieldId(playerId, i)
      fields[id] = {
        id,
        kind: 'victory',
        label,
        row: ROW.victory,
        owner: playerId,
        fee: 0,
        stack: [],
      }
    }
  }

  // Ein gemeinsamer Markt neben den Erntefeldern (nur Eingang, Küchenware).
  const marketInputs: FieldState['inputs'] = [[]]
  fields[MARKET_FIELD_ID] = {
    id: MARKET_FIELD_ID,
    kind: 'market',
    label: 'Markt',
    row: ROW.market,
    fee: 0,
    stack: marketInputs[0]!,
    inputs: marketInputs,
    demand: 0,
  }

  const players: PlayerState[] = playerIds.map((id) => ({
    id,
    name: PLAYER_META[id].name,
    money: START_MONEY,
    bankClaims: 0,
    color: PLAYER_META[id].color,
  }))

  const startPlayerIndex = Math.floor(rng() * players.length)
  const single =
    players.length === 1
      ? 'Einspieler — Startguthaben 5¤, ein eigener Schuppen.'
      : `${players.length} Spieler · Startguthaben 5¤ · jeder hat einen Schuppen (ohne Gebühren).`

  return {
    scenarioId,
    fields,
    decks,
    players,
    currentPlayerIndex: startPlayerIndex,
    startPlayerIndex,
    bank: BANK_START,
    auctionUsed: false,
    selection: null,
    actionError: null,
    demandRollSeq: 0,
    demandRollFlash: null,
    demandRollIds: [],
    planetLimitSeq: 0,
    planetLimitFlash: null,
    planetLimitId: null,
    producedIds: [],
    stats: {
      productions: 0,
      productsDelivered: 0,
      marketCollapses: 0,
      sourceCollapses: 0,
      marketsSpawned: 0,
      stacksClearedByAce: 0,
      marketIncome: 0,
      feesPaidToPlayers: 0,
      feesPaidToBank: 0,
      auctionsSold: 0,
      auctionVolume: 0,
    },
    log: [
      {
        id: 1,
        text: `Szenario ${scenario.id} – ${scenario.name} gestartet (${single}). ${players[startPlayerIndex]!.name} beginnt.`,
        tone: 'info',
      },
    ],
    logSeq: 1,
    turn: 1,
    ended: false,
    winnerText: null,
    rngSeed: seed,
    marketSpawnSeq: 0,
    beetsPerPlayer: scenario.beetsPerPlayer,
  }
}
