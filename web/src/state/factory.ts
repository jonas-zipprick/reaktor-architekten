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
  POINTS_SUIT,
  SEED_BED_RECIPE,
  SUITS,
} from '../types'
import { createRng, shuffle } from './rng'

const RANKS: Rank[] = [7, 6, 5, 4, 3, 2]
const CARDS_PER_RANK = 6
/** Zusätzlich je Sorte (gleichmäßig über die Ränge). */
const EXTRA_CARDS_PER_DECK = 40
/** Siegpunkt-Deck: endlich, gekaufte Karten kommen nicht zurück. */
const POINTS_CARDS_PER_RANK = 8
const POINTS_EXTRA_CARDS = 36

/** Eindeutige ID-Präfixe (suit[0] kollidiert bei spades/steel). */
const SUIT_ID_PREFIX: Record<Suit, string> = {
  hearts: 'h',
  spades: 's',
  energy: 'e',
  diamonds: 'd',
  clubs: 'c',
  steel: 't',
  points: 'p',
}

const START_CARDS_PER_SOURCE = 2
/** Küchen-Ausgabe: hoher Startvorrat der Produktfarbe. */
export const FACTORY_OUTPUT_SIZE = 24
const START_MONEY = 5
/** Große Bank — leere Bank beendet die Partie nicht. */
const BANK_START = 2000

function buildDeck(suit: Suit, rng: () => number): Card[] {
  const cards: Card[] = []
  let n = 0
  const prefix = SUIT_ID_PREFIX[suit]
  const perRank = suit === POINTS_SUIT ? POINTS_CARDS_PER_RANK : CARDS_PER_RANK
  const extra = suit === POINTS_SUIT ? POINTS_EXTRA_CARDS : EXTRA_CARDS_PER_DECK
  for (const rank of RANKS) {
    for (let i = 0; i < perRank; i++) {
      n += 1
      cards.push({
        id: `${prefix}${n}`,
        suit,
        rank,
      })
    }
  }
  for (let i = 0; i < extra; i++) {
    n += 1
    cards.push({
      id: `${prefix}${n}`,
      suit,
      rank: RANKS[i % RANKS.length]!,
    })
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
    decks[suit] = { draw: buildDeck(suit, rng), discard: [] }
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
    if (f.kind === 'market') {
      field.demand = 0
      field.inputs = [[]]
      const out = takeOutputCards(decks, POINTS_SUIT, FACTORY_OUTPUT_SIZE)
      field.outputs = [out]
      field.outputsRevealed = [out.length > 0 ? 1 : 0]
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
    for (let i = 1; i <= scenario.beetsPerPlayer; i++) {
      const id = `lager-${playerId}-${i}`
      fields[id] = {
        id,
        kind: 'storage',
        label: personalBeetLabel(playerId, i, multi),
        row: ROW.storage,
        owner: playerId,
        fee: 0,
        stack: [],
      }
    }
    const vpName = multi
      ? `Siegpunkte ${PLAYER_META[playerId].short}`
      : 'Siegpunkte'
    fields[`sieg-${playerId}`] = {
      id: `sieg-${playerId}`,
      kind: 'victory',
      label: vpName,
      row: ROW.victory,
      owner: playerId,
      fee: 0,
      stack: [],
      inputs: [[], [], []],
    }
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
      ? 'Einspieler — Startguthaben 5¤, eigene Schuppen.'
      : `${players.length} Spieler · Startguthaben 5¤ · jeder hat eigene Schuppen (ohne Gebühren).`

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
    marketsToWin: scenario.marketsToWin,
    beetsPerPlayer: scenario.beetsPerPlayer,
  }
}
