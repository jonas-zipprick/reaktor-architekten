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
import { hasOwnership, isSeedBed, SEED_BED_RECIPE, SUITS } from '../types'
import { createRng, shuffle } from './rng'

const RANKS: Rank[] = [7, 6, 5, 4, 3, 2]
const CARDS_PER_RANK = 6
/** Zusätzlich je Sorte (gleichmäßig über die Ränge). */
const EXTRA_CARDS_PER_DECK = 40

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
/** Küchen-Ausgabe: hoher Startvorrat der Produktfarbe. */
export const FACTORY_OUTPUT_SIZE = 24
const START_MONEY = 10
/** Große Bank — leere Bank beendet die Partie nicht. */
const BANK_START = 2000

function buildDeck(suit: Suit, rng: () => number): Card[] {
  const cards: Card[] = []
  let n = 0
  const prefix = SUIT_ID_PREFIX[suit]
  for (const rank of RANKS) {
    for (let i = 0; i < CARDS_PER_RANK; i++) {
      n += 1
      cards.push({
        id: `${prefix}${n}`,
        suit,
        rank,
      })
    }
  }
  for (let i = 0; i < EXTRA_CARDS_PER_DECK; i++) {
    n += 1
    cards.push({
      id: `${prefix}${n}`,
      suit,
      rank: RANKS[i % RANKS.length]!,
    })
  }
  return shuffle(cards, rng)
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
    }
    if (f.kind === 'factory' && f.suit) {
      field.demand = 0
      field.output = []
      for (let n = 0; n < FACTORY_OUTPUT_SIZE; n++) {
        const card = decks[f.suit]!.draw.pop()
        if (!card) break
        field.output.push(card)
      }
    }
    if (f.kind === 'source' && f.suit) {
      if (isSeedBed(f)) {
        // Saatstand: endloser Saat-Ausgang, Obst-Eingang, Bedarfsmesser bei 0.
        field.demand = 0
        field.recipe = SEED_BED_RECIPE
        field.output = []
        for (let n = 0; n < FACTORY_OUTPUT_SIZE; n++) {
          const card = decks[f.suit]!.draw.pop()
          if (!card) break
          field.output.push(card)
        }
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
      ? 'Einspieler — Startguthaben 10¤, eigene Schuppen.'
      : `${players.length} Spieler · jeder hat eigene Schuppen (ohne Gebühren).`

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
