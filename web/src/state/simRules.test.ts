import type { CellState, Chip, PlacedField, PlayerId, PlayerState, Route } from '../types'
import { supplyPayout } from './factoryHit'
import {
  factoryEffect,
  payPlayer,
  tierAllows,
  upgradeCost,
} from './simRules'
import {
  abortTransport,
  deliverChip,
  routeAlong,
  takeSourceChip,
  triggerFactory,
  type SimState,
} from './simTurn'

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`)
  }
}

function players(): Record<PlayerId, PlayerState> {
  return {
    1: { money: 12, owed: 0 },
    2: { money: 12, owed: 0 },
    3: { money: 0, owed: 0 },
    4: { money: 0, owed: 0 },
  }
}

function cell(partial: Partial<CellState> & Pick<CellState, 'terrain'>): CellState {
  return {
    hex: partial.hex ?? { q: 0, r: 0 },
    revealed: true,
    voltage: 0,
    water: 0,
    heat: 0,
    consumers: [],
    sourceStock: [],
    ...partial,
  }
}

function chip(partial: Partial<Chip> & Pick<Chip, 'color'>): Chip {
  return {
    id: 'c1',
    state: 'flying',
    hex: { q: 0, r: 0 },
    pilot: 1,
    seen: { '0,0': 1 },
    ...partial,
  }
}

function state(partial: Partial<SimState> = {}): SimState {
  return {
    day: 1,
    activePlayer: 1,
    playerIds: [1, 2],
    players: players(),
    bank: 20,
    cells: {},
    chips: [],
    routes: {},
    log: [],
    simPasses: 0,
    simDone: false,
    simQueue: [],
    selectedChipId: null,
    selectedHex: null,
    freibeuters: [],
    piratePurse: 0,
    ...partial,
  }
}

let seq = 0
const mint = () => `n${++seq}`

assertEqual(supplyPayout(-5, 3), 12)
assertEqual(tierAllows('blue', 'blue'), true)
assertEqual(tierAllows('blue', 'purple'), false)
assertEqual(tierAllows('purple', 'purple'), true)
assertEqual(tierAllows('purple', 'red'), false)
assertEqual(tierAllows('red', 'red'), true)
assertEqual(upgradeCost('blue', 'purple'), 2)
assertEqual(upgradeCost('blue', 'red'), 4)
assertEqual(upgradeCost('red', 'blue'), null)

const solar = factoryEffect(
  { kind: 'solar', owner: 2, charge: [], fee: 3 },
  chip({ color: 'purple', resource: 'light' }),
)
assertEqual(solar?.type, 'convert')
assertEqual(factoryEffect(
  { kind: 'solar', owner: 2, charge: [] },
  chip({ color: 'blue', resource: 'water' }),
), null)
assertEqual(factoryEffect(
  { kind: 'solar', owner: null, charge: [] },
  chip({ color: 'purple', resource: 'light' }),
), null)

const paid = payPlayer(players(), 1, 2, 4)
assertEqual(paid?.[1].money, 8)
assertEqual(paid?.[2].money, 16)
const ownPlayers = players()
assertEqual(payPlayer(ownPlayers, 1, 1, 4), ownPlayers)

const taken = takeSourceChip(
  state({
    cells: {
      '0,0': cell({
        terrain: 'water',
        sourceOwner: 2,
        sourceFee: 3,
        sourceStock: ['blue'],
      }),
    },
  }),
  { q: 0, r: 0 },
  0,
  mint,
)
assertEqual(taken.players?.[1].money, 9)
assertEqual(taken.players?.[2].money, 15)
assertEqual(taken.chips?.[0].resource, 'water')
assertEqual(taken.chips?.[0].pilot, 1)
assertEqual(taken.cells?.['0,0'].sourceStock.length, 0)

const neutralTake = takeSourceChip(
  state({
    cells: {
      '0,0': cell({
        terrain: 'water',
        sourceStock: ['red'],
      }),
    },
  }),
  { q: 0, r: 0 },
  0,
  mint,
)
assertEqual(neutralTake.chips, undefined)
assertEqual(neutralTake.players, undefined)

const link: Record<string, Route> = {
  '0,0|1,0': { owner: 2, tier: 'blue', fee: 2 },
}
const moved = routeAlong(
  state({
    routes: link,
    chips: [chip({ color: 'blue', resource: 'water' })],
  }),
  3,
)
assertEqual(moved.chips?.[0].hex.q, 1)
assertEqual(moved.players?.[1].money, 10)
assertEqual(moved.players?.[2].money, 14)

const blocked = routeAlong(
  state({
    routes: link,
    chips: [chip({ color: 'red', resource: 'uranium' })],
  }),
  3,
)
assertEqual(blocked.chips, undefined)

const loop = routeAlong(
  state({
    routes: { '0,0|1,0': { owner: 1, tier: 'red', fee: 9 } },
    chips: [
      chip({
        color: 'red',
        resource: 'heat',
        seen: { '0,0': 1, '1,0': 2 },
      }),
    ],
  }),
  3,
)
assertEqual(loop.chips?.length, 0)
assertEqual(loop.activePlayer, 2)
assertEqual(loop.players?.[1].money, 12)

const turbine: PlacedField = {
  kind: 'turbine',
  owner: 2,
  charge: ['red'],
  fee: 1,
}
const split = triggerFactory(
  state({
    cells: { '0,0': cell({ terrain: 'empty', field: turbine }) },
    chips: [chip({ color: 'purple', resource: 'heat' })],
  }),
  mint,
)
assertEqual(split.chips?.length, 2)
assertEqual(split.chips?.[0].resource, 'voltage')
assertEqual(split.chips?.[0].color, 'purple')
assertEqual(split.chips?.[1].color, 'red')
assertEqual(split.chips?.[1].resource, 'voltage')
assertEqual(split.chips?.[1].pilot, 1)
assertEqual(split.players?.[1].money, 11)
assertEqual(split.cells?.['0,0'].field?.charge.length, 0)
assertEqual(split.simQueue?.length, 1)

const planet = deliverChip(
  state({
    bank: 30,
    cells: {
      '0,0': cell({
        terrain: 'planet',
        planetName: 'Kepler',
        voltage: -5,
        planetOwner: 2,
        importFee: 4,
        consumers: [{ id: 'u1', type: 'voltage', approver: 2 }],
      }),
    },
    chips: [chip({ color: 'red', resource: 'voltage' })],
  }),
  true,
)
assertEqual(planet.players?.[1].money, 12 - 4 + 12)
assertEqual(planet.players?.[2].money, 12 + 4)
assertEqual(planet.bank, 18)
assertEqual(planet.cells?.['0,0'].voltage, -2)
assertEqual(planet.chips?.length, 0)

const dumped = deliverChip(
  state({
    cells: {
      '0,0': cell({
        terrain: 'planet',
        voltage: -5,
        planetOwner: 2,
        importFee: 4,
        consumers: [{ id: 'u1', type: 'voltage', approver: 2 }],
      }),
    },
    chips: [chip({ color: 'blue', resource: 'voltage' })],
  }),
  false,
)
assertEqual(dumped.players?.[1].money, 12)
assertEqual(dumped.cells?.['0,0'].voltage, -4)

const refused = deliverChip(
  state({
    cells: { '0,0': cell({ terrain: 'planet', voltage: -3 }) },
    chips: [chip({ color: 'blue', resource: 'light' })],
  }),
  true,
)
assertEqual(refused.chips, undefined)

const stopped = abortTransport(
  state({ chips: [chip({ color: 'blue', resource: 'water' })] }),
)
assertEqual(stopped.chips?.length, 0)
assertEqual(stopped.activePlayer, 2)

console.log('sim rules ok')
