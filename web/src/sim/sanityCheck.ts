/**
 * Kurzer Coverage-/Scoring-Check für die Monte-Carlo-Heuristik.
 * Ausführen: npx tsx src/sim/sanityCheck.ts
 */
import { createGame } from '../state/factory'
import {
  listBuyInfra,
  listGifts,
  listLegalMoves,
  planAuction,
  planLagerOffer,
  scoreEndTurn,
  scoreMove,
  pickTurnAction,
} from './legalMoves'
import { simulateGame } from './simulate'
import {
  executeEndTurn,
  factoryOutputs,
  harvestFieldScore,
  harvestStackDiversity,
  isVictoryFieldComplete,
  moneyVictoryScore,
  playerHarvestScore,
  playerVictoryScore,
} from '../state/rules'
import {
  BEET_DEFS,
  beetKindForSeat,
  isMarketField,
  isRegen,
  isWaterTrade,
  MARKET_PRICES,
  marketFieldId,
  victoryColumnCount,
  WATER_TRADE_FIELD_ID,
  type Card,
  type CropSuit,
  type Rank,
} from '../types'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function main(): void {
  const state = createGame('B', 42)
  const moves = listLegalMoves(state)
  const buys = listBuyInfra(state)
  const gifts = listGifts(state)
  const endScore = scoreEndTurn(state)

  assert(moves.length > 0, 'Szenario B: erwartet legale Moves')
  const me = state.players[state.currentPlayerIndex]!.id
  assert(gifts.length > 0, 'Szenario B: erwartet Gift-Kandidaten')
  assert(
    gifts.every((g) => g.action.amount >= 1 && g.action.to !== me),
    'Gifts: Betrag ≥1, anderer Spieler',
  )
  assert(planAuction(state, 1, () => 0) === null, 'Auktion muss tot sein')
  assert(planLagerOffer(state, 1, () => 0) === null, 'LagerOffer muss tot sein')

  let sawVictoryField = false
  let seedBeds = 0
  let beets = 0
  let rains = 0
  for (const f of Object.values(state.fields)) {
    if (f.kind === 'victory') {
      sawVictoryField = true
      assert(f.label.includes('Ernte'), `${f.id} sollte Ernte heißen`)
    }
    if (f.kind === 'source' && f.suit === 'hearts') {
      seedBeds += 1
      assert(f.owner == null, `${f.id} ist gemeinschaftlich`)
      assert(f.demand === 0, `${f.id} startet mit Bedarf 0`)
      assert(factoryOutputs(f).length >= 1, `${f.id} braucht outputs`)
      assert(
        factoryOutputs(f).some((o) => o.length > 0),
        `${f.id} startet mit gefüllter Ausgabe`,
      )
    }
    if (isRegen(f)) {
      rains += 1
      assert(f.owner, `${f.id} braucht Eigentümer`)
      assert(f.stack.length === 1, `${f.id} startet mit 1 Karte`)
    }
    if (
      f.kind === 'factory' &&
      f.suit &&
      (f.suit === 'clubs' ||
        f.suit === 'berry' ||
        f.suit === 'veg' ||
        f.suit === 'herb')
    ) {
      beets += 1
      assert(f.owner, `${f.id} braucht Eigentümer`)
      assert(f.demand == null, `${f.id} ohne Bedarfsmesser`)
      assert(factoryOutputs(f).length >= 1, `${f.id} braucht outputs`)
      assert(
        factoryOutputs(f).every((o) => o.length === 0),
        `${f.id} startet mit leerer Ausgabe`,
      )
    }
  }
  assert(sawVictoryField, 'Erntefelder erwartet')
  assert(seedBeds >= 1, 'mindestens 1 Saatstand')
  assert(rains === state.players.length, '1 Regen je Spieler')
  assert(beets === state.players.length, '1 Beet je Spieler')
  const water = state.fields[WATER_TRADE_FIELD_ID]
  assert(water && isWaterTrade(water), 'Wasserhandel erwartet')
  assert(water!.demand === 0, 'Wasserhandel startet mit Bedarf 0')
  assert(factoryOutputs(water!).length >= 1, 'Wasserhandel braucht Ausgabe')

  // Sitzplatz → Beet-Art
  for (let seat = 0; seat < state.players.length; seat++) {
    const pid = state.players[seat]!.id
    const kind = beetKindForSeat(seat)
    const def = BEET_DEFS[kind]
    const beet = Object.values(state.fields).find(
      (f) =>
        f.kind === 'factory' && f.owner === pid && f.suit === def.suit,
    )
    assert(beet, `Spieler ${pid} braucht ${def.label}`)
  }

  const harvestCount = Object.values(state.fields).filter(
    (f) => f.kind === 'victory',
  ).length
  const cols = victoryColumnCount(state.players.length)
  assert(
    harvestCount === state.players.length * cols,
    `${cols} Erntefelder je Spieler`,
  )
  const markets = Object.values(state.fields).filter((f) => f.kind === 'market')
  assert(markets.length === 3, 'genau 3 Marktstände')
  assert(state.marketDemand === 0, 'Markt startet mit Bedarf 0')
  for (const m of markets) {
    assert(
      m.marketPrice === 2 || m.marketPrice === 4 || m.marketPrice === 6,
      `${m.id} Preis`,
    )
    assert(m.owner == null, `${m.id} ist gemeinschaftlich`)
  }

  const solo = createGame('A', 1)
  assert(
    Object.values(solo.fields).filter(
      (f) => f.kind === 'factory' && f.suit === 'clubs',
    ).length === 1,
    'Solo: nur Apfelbeet',
  )
  assert(
    Object.values(solo.fields).filter(
      (f) =>
        f.kind === 'factory' &&
        (f.suit === 'berry' || f.suit === 'veg' || f.suit === 'herb'),
    ).length === 0,
    'Solo: keine anderen Beete',
  )
  assert(
    Object.values(solo.fields).filter((f) => f.kind === 'victory').length === 3,
    'Solo: 3 Erntefelder',
  )

  const foreignPrivate = Object.values(state.fields).filter(
    (f) => f.owner && f.owner !== me && f.owner !== 'state',
  )
  assert(foreignPrivate.length > 0, 'Mehrspieler: fremde Privatfelder erwartet')
  for (const field of foreignPrivate) {
    const used = moves.some(
      (m) => m.move.to === field.id || m.move.from === field.id,
    )
    assert(!used, `fremdes Privatfeld ${field.id} muss tabu sein`)
  }

  assert(Number.isFinite(endScore), 'scoreEndTurn endlich')

  // Legale Züge müssen Depots und (sobald Ware da ist) Marktstände abdecken.
  const toWater = moves.some((m) => m.move.to === WATER_TRADE_FIELD_ID)
  const fromWater = moves.some((m) => m.move.from === WATER_TRADE_FIELD_ID)
  assert(toWater, 'Wasserhandel-Eingang muss Ziel sein können')
  assert(fromWater, 'Wasserhandel-Ausgabe muss Quelle sein können')
  for (const price of MARKET_PRICES) {
    assert(state.fields[marketFieldId(price)], `Marktstand ${price}T fehlt`)
  }
  const marketTargets = moves.filter((m) =>
    isMarketField(state.fields[m.move.to]!),
  )
  const productMoves = moves.filter((m) => {
    const suit = m.check.card?.suit
    return (
      suit != null && ['clubs', 'berry', 'veg', 'herb'].includes(suit)
    )
  })
  if (productMoves.length > 0) {
    assert(marketTargets.length > 0, 'mit Ernte-Karten muss Markt erreichbar sein')
  }
  for (const m of moves) {
    assert(
      Number.isFinite(scoreMove(state, m)),
      `scoreMove ${m.move.from}→${m.move.to}`,
    )
  }

  // Markt→Markt: künstlich befüllen und prüfen, dass Scoring stark negativ ist.
  {
    const m1 = state.fields[marketFieldId(2)]!
    const m2 = state.fields[marketFieldId(4)]!
    const probe = {
      id: 'probe-market',
      suit: 'clubs' as const,
      rank: 7 as const,
    }
    m1.stack.push(probe)
    const withCard = listLegalMoves(state)
    const m2m = withCard.filter(
      (m) => m.move.from === m1.id && m.move.to === m2.id,
    )
    assert(m2m.length > 0, 'Markt→Markt muss legal sein')
    const m2mScore = Math.max(...m2m.map((m) => scoreMove(state, m)))
    assert(m2mScore < -40, `Markt→Markt zu hoch bewertet (${m2mScore})`)
    m1.stack.pop()
  }

  let sawEnd = false
  let sawGift = false
  const rng = (() => {
    let i = 0
    return () => {
      i += 1
      return (i * 0.17) % 1
    }
  })()
  for (let i = 0; i < 80; i++) {
    const pick = pickTurnAction(state, moves, 0, rng)
    if (pick.kind === 'endTurn') sawEnd = true
    if (pick.kind === 'gift') sawGift = true
  }
  assert(sawEnd, 'Zufall (h=0) muss endTurn treffen können')
  assert(sawGift, 'Zufall (h=0) muss gift treffen können')

  assert(
    buys.every((b) => b.price <= state.players[0]!.money) || buys.length === 0,
    'Buy-Kandidaten müssen bezahlbar sein',
  )
  assert(buys.length === 0, 'keine käufliche Infrastruktur mehr')

  const run = simulateGame({
    scenarioId: 'B',
    seed: 99,
    maxActions: 400,
    heuristic: 1,
  })
  assert(
    ['finished', 'aborted', 'stuck'].includes(run.outcome),
    `ungültiges outcome ${run.outcome}`,
  )
  assert(typeof run.harvestDone === 'number', 'harvestDone fehlt')
  assert(typeof run.marketBuys === 'number', 'marketBuys fehlt')
  const types = new Set(run.record.actions.map((a) => a.type))
  assert(!types.has('auction'), 'Sim darf keine Auktion erzeugen')
  assert(!types.has('lagerOffer'), 'Sim darf kein lagerOffer erzeugen')
  assert(!types.has('buyFieldCopy'), 'Sim darf keine Feldkopie kaufen')
  assert(!types.has('setFee'), 'Sim darf keine Gebühr setzen')
  assert(!types.has('buyInfra'), 'Sim darf keine Infra kaufen')
  assert(types.has('move') || types.has('endTurn'), 'Sim braucht move/endTurn')

  const runA = simulateGame({
    scenarioId: 'A',
    seed: 7,
    maxActions: 200,
    heuristic: 1,
  })
  assert(
    ['finished', 'aborted', 'stuck'].includes(runA.outcome),
    `Solo outcome ${runA.outcome}`,
  )

  // Szenario C/D: Saatstand-Anzahl
  for (const [id, expect] of [
    ['C', 1],
    ['D', 2],
  ] as const) {
    const g = createGame(id, 1)
    const n = Object.values(g.fields).filter(
      (f) => f.kind === 'source' && f.suit === 'hearts',
    ).length
    assert(n === expect, `Szenario ${id}: ${expect} Saatstand(e), got ${n}`)
  }

  // Vielfalt-SP + Spielende erst nach Zugende
  {
    const g = createGame('B', 3)
    const actor = g.players[g.currentPlayerIndex]!
    const harvest = Object.values(g.fields).filter(
      (f) => f.kind === 'victory' && f.owner === actor.id,
    )
    assert(harvest.length === 3, 'B: 3 Erntefelder für Zugspieler')

    const mkSeq = (suits: CropSuit[], tag: string): Card[] => {
      const ranks: Rank[] = [7, 6, 5, 4, 3, 2]
      return ranks.map((rank, i) => ({
        id: `${tag}-${rank}`,
        suit: suits[i % suits.length]!,
        rank,
      }))
    }

    harvest[0]!.stack = mkSeq(['clubs'], 'mono')
    harvest[1]!.stack = mkSeq(['clubs', 'berry'], 'duo')
    harvest[2]!.stack = mkSeq(['clubs', 'berry', 'veg', 'herb'], 'quad')
    assert(harvest.every(isVictoryFieldComplete), 'Teststapel müssen voll sein')
    assert(harvestStackDiversity(harvest[0]!.stack) === 1, 'mono diversity')
    assert(harvestFieldScore(harvest[0]!) === 2, '1 Sorte → 2 SP')
    assert(harvestFieldScore(harvest[1]!) === 3, '2 Sorten → 3 SP')
    assert(harvestFieldScore(harvest[2]!) === 5, '4 Sorten → 5 SP')
    assert(playerHarvestScore(g, actor.id) === 10, '2+3+5 SP')
    actor.money = 25
    assert(moneyVictoryScore(25) === 3, '25T → 3 SP')
    assert(moneyVictoryScore(0) === 0, '0T → 0 SP')
    assert(moneyVictoryScore(1) === 1, '1T → 1 SP')
    assert(moneyVictoryScore(10) === 1, '10T → 1 SP')
    assert(moneyVictoryScore(11) === 2, '11T → 2 SP')
    assert(playerVictoryScore(g, actor.id) === 13, '10 Ernte + 3 Geld')

    // Mit vollen Stapeln ist das Spiel noch nicht zu Ende.
    assert(!g.ended, 'vor Zugende kein Ende')
    const after = executeEndTurn(g)
    assert(after.ended, 'Zugende mit 3 vollen Stapeln beendet')
    assert(
      (after.winnerText ?? '').includes('Siegpunkte'),
      `winnerText erwartet SP: ${after.winnerText}`,
    )
    assert(
      (after.winnerText ?? '').includes('Geld'),
      `winnerText erwartet Geld-SP: ${after.winnerText}`,
    )
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        moves: moves.length,
        buys: buys.length,
        gifts: gifts.length,
        endScore,
        marketTargets: marketTargets.length,
        waterMoves: moves.filter(
          (m) =>
            m.move.to === WATER_TRADE_FIELD_ID ||
            m.move.from === WATER_TRADE_FIELD_ID,
        ).length,
        sim: {
          outcome: run.outcome,
          actions: run.actions,
          turns: run.turns,
          harvestDone: run.harvestDone,
          harvestCards: run.harvestCards,
          actionTypes: [...types],
        },
        simSolo: {
          outcome: runA.outcome,
          actions: runA.actions,
          turns: runA.turns,
          harvestDone: runA.harvestDone,
        },
      },
      null,
      2,
    ),
  )
}

main()
