import { getScenario, PLAYER_META, playersFor } from '../data/scenarios'
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
import { hasOwnership, SUITS } from '../types'
import { createRng, shuffle } from './rng'

const RANKS: Rank[] = [7, 6, 5, 4, 3, 2, 1]
const CARDS_PER_RANK = 6

const STATE_START_FEE = 1
const START_CARDS_PER_SOURCE = 2
const START_MONEY = 10
const START_MONEY_SOLO = 20
const BANK_PER_PLAYER = 40

function buildDeck(suit: Suit, rng: () => number): Card[] {
  const cards: Card[] = []
  let n = 0
  for (const rank of RANKS) {
    for (let i = 0; i < CARDS_PER_RANK; i++) {
      n += 1
      cards.push({
        id: `${suit[0]}${n}`,
        suit,
        rank,
      })
    }
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
    const owned = hasOwnership(f.kind)
    const field: FieldState = {
      id: f.id,
      kind: f.kind,
      label: f.label,
      suit: f.suit,
      recipe: f.recipe,
      row: f.row,
      owner: owned ? 'state' : undefined,
      fee: owned ? (f.fee ?? STATE_START_FEE) : 0,
      stack: [],
    }
    if (f.kind === 'market') {
      field.demand = 0
    }
    if (f.kind === 'source' && f.suit) {
      for (let n = 0; n < START_CARDS_PER_SOURCE; n++) {
        const card = decks[f.suit]!.draw.pop()
        if (card) field.stack.push(card)
      }
    }
    fields[f.id] = field
  }

  const startMoney =
    playerIds.length === 1 ? START_MONEY_SOLO : START_MONEY
  const players: PlayerState[] = playerIds.map((id) => ({
    id,
    name: PLAYER_META[id].name,
    money: startMoney,
    bankClaims: 0,
    color: PLAYER_META[id].color,
  }))

  const startPlayerIndex = Math.floor(rng() * players.length)
  const single =
    players.length === 1
      ? 'Einspieler — Startguthaben 20¤, Lager staatlich, keine Auktionen.'
      : `${players.length} Spieler · nur Lager sind auktionierbar.`

  return {
    scenarioId,
    fields,
    decks,
    players,
    currentPlayerIndex: startPlayerIndex,
    startPlayerIndex,
    bank: players.length * BANK_PER_PLAYER,
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
    marketExp: 0,
  }
}
