import {
  getScenario,
  personalBeetLabel,
  personalGardenBeetLabel,
  personalRegenLabel,
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
  BEET_DEFS,
  beetFieldId,
  beetKindForSeat,
  GARDEN_RECIPE,
  hasOwnership,
  isPersonalGarden,
  isRegen,
  isSeedBed,
  MARKET_PRICES,
  marketFieldId,
  regenFieldId,
  SEED_BED_RECIPE,
  SUITS,
  victoryColumnCount,
  victoryFieldId,
  WATER_TRADE_FIELD_ID,
  WATER_TRADE_RECIPE,
} from '../types'
import { createRng, shuffle } from './rng'

const RANKS: Rank[] = [7, 6, 5, 4, 3, 2]

/** Eindeutige ID-Präfixe (suit[0] kollidiert bei spades/steel). */
const SUIT_ID_PREFIX: Record<Suit, string> = {
  hearts: 'h',
  energy: 'e',
  clubs: 'c',
  berry: 'b',
  veg: 'v',
  herb: 'k',
}

const START_CARDS_PER_SOURCE = 2
/** Persönlicher Regen startet mit einer offenen Wasserkarte. */
const START_CARDS_PER_REGEN = 1
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
    // Beet und Regen kommen persönlich je Spieler (nicht aus dem Katalog).
    if (isPersonalGarden(f) || isRegen(f)) continue
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
        // Saatstand: gemeinschaftlich, Saat-Ausgabe, Ernte-Eingang, Bedarf 0.
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
  const harvestN = victoryColumnCount(playerIds.length)
  for (let seat = 0; seat < playerIds.length; seat++) {
    const playerId = playerIds[seat]!
    const rainId = regenFieldId(playerId)
    const rainStack: Card[] = []
    for (let n = 0; n < START_CARDS_PER_REGEN; n++) {
      const card = decks.energy!.draw.pop()
      if (card) rainStack.push(card)
    }
    fields[rainId] = {
      id: rainId,
      kind: 'source',
      suit: 'energy',
      label: personalRegenLabel(playerId, multi),
      row: ROW.source,
      owner: playerId,
      fee: 0,
      stack: rainStack,
    }

    // Ein Beet je Spieler: Sitz 0 Obst, 1 Beeren, 2 Gemüse, 3 Kräuter.
    const kind = beetKindForSeat(seat)
    const def = BEET_DEFS[kind]
    const gardenId = beetFieldId(playerId, kind)
    fields[gardenId] = {
      id: gardenId,
      kind: 'factory',
      suit: def.suit,
      label: personalGardenBeetLabel(playerId, kind, multi),
      recipe: GARDEN_RECIPE,
      row: ROW.factory,
      owner: playerId,
      fee: 0,
      stack: [],
      outputs: [[]],
      outputsRevealed: [0],
    }

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
    for (let i = 0; i < harvestN; i++) {
      const base = `Ernte ${i + 1}`
      const label = multi ? `${PLAYER_META[playerId].short}·${base}` : base
      const vid = victoryFieldId(playerId, i)
      fields[vid] = {
        id: vid,
        kind: 'victory',
        label,
        row: ROW.victory,
        owner: playerId,
        fee: 0,
        stack: [],
      }
    }
  }

  // Gemeinschaftlicher Wasserhandel (Eingang + Ausgabe Wasser, Bedarf 0).
  {
    const out = takeOutputCards(decks, 'energy', FACTORY_OUTPUT_SIZE)
    fields[WATER_TRADE_FIELD_ID] = {
      id: WATER_TRADE_FIELD_ID,
      kind: 'source',
      suit: 'energy',
      label: 'Wasserhandel',
      recipe: WATER_TRADE_RECIPE,
      row: ROW.source,
      fee: 0,
      stack: [],
      demand: 0,
      outputs: [out],
      outputsRevealed: [out.length > 0 ? 1 : 0],
    }
  }

  // Drei gemeinsame Marktstände (2¤ / 4¤ / 6¤); gemeinsamer Bedarfsmesser.
  for (const price of MARKET_PRICES) {
    const id = marketFieldId(price)
    fields[id] = {
      id,
      kind: 'market',
      label: `${price}¤`,
      row: ROW.market,
      fee: 0,
      stack: [],
      marketPrice: price,
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
      ? 'Einspieler — Startguthaben 5¤, eigener Regen, Apfelbeet und Schuppen.'
      : `${players.length} Spieler · Startguthaben 5¤ · jeder hat Regen, ein eigenes Beet und Schuppen.`

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
    endTurnDice: null,
    endTurnDiceSeq: 0,
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
    marketDemand: 0,
    beetsPerPlayer: scenario.beetsPerPlayer,
  }
}
