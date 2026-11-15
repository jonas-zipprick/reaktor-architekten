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
  planFeeChange,
  planLagerOffer,
  scoreEndTurn,
  pickTurnAction,
} from './legalMoves'
import { simulateGame } from './simulate'
import { factoryOutputs } from '../state/rules'

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

  // Fee: bei Besitz und offenen Erntespalten → auf 0 setzen.
  const owned = createGame('B', 42)
  const ownerId = owned.players[owned.currentPlayerIndex]!.id
  const kitchen = Object.values(owned.fields).find((f) => f.kind === 'factory')
  assert(kitchen, 'Küche erwartet')
  kitchen!.owner = ownerId
  kitchen!.fee = 2
  const fee = planFeeChange(owned, 1, () => 0)
  assert(fee && fee.fee === 0, `bei offener Ernte Fee 0 erwartet, got ${fee?.fee}`)

  let sawHarvestMove = false
  let sawVictoryField = false
  for (const f of Object.values(state.fields)) {
    if (f.kind === 'victory') {
      sawVictoryField = true
      assert(f.label.includes('Ernte'), `${f.id} sollte Ernte heißen`)
    }
    if (f.kind === 'factory' || (f.kind === 'source' && f.suit === 'hearts')) {
      assert(factoryOutputs(f).length >= 1, `${f.id} braucht outputs`)
    }
  }
  assert(sawVictoryField, 'Erntefelder erwartet')
  const harvestCount = Object.values(state.fields).filter(
    (f) => f.kind === 'victory',
  ).length
  assert(harvestCount === state.players.length * 3, '3 Erntefelder je Spieler')
  const market = Object.values(state.fields).find((f) => f.kind === 'market')
  assert(market, 'Markt erwartet')
  assert(market!.demand === 0, 'Markt startet mit Bedarf 0')
  assert(
    (market!.inputs?.length ?? 0) >= 1,
    'Markt braucht mindestens einen Eingang',
  )
  for (const m of moves) {
    const to = state.fields[m.move.to]
    if (to?.kind === 'victory') {
      sawHarvestMove = true
      break
    }
  }
  assert(sawHarvestMove, 'Erwarte legale Züge auf ein Erntefeld')

  assert(Number.isFinite(endScore), 'scoreEndTurn endlich')

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

  const run = simulateGame({
    scenarioId: 'B',
    seed: 99,
    maxActions: 400,
    heuristic: 1,
  })
  assert(
    ['finished', 'lost', 'stalled', 'aborted', 'stuck'].includes(run.outcome),
    `ungültiges outcome ${run.outcome}`,
  )
  const types = new Set(run.record.actions.map((a) => a.type))
  assert(!types.has('auction'), 'Sim darf keine Auktion erzeugen')
  assert(!types.has('lagerOffer'), 'Sim darf kein lagerOffer erzeugen')
  assert(!types.has('buyFieldCopy'), 'Sim darf keine Feldkopie kaufen')

  console.log(
    JSON.stringify(
      {
        ok: true,
        moves: moves.length,
        buys: buys.length,
        gifts: gifts.length,
        endScore,
        sim: {
          outcome: run.outcome,
          actions: run.actions,
          turns: run.turns,
          expansions: run.marketsSpawned,
          actionTypes: [...types],
        },
      },
      null,
      2,
    ),
  )
}

main()
