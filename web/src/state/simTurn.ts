import { playerLabel } from '../data/labels'
import { pirateFeeAt, type Freibeuter } from '../data/freibeuter'
import { resourceName } from './factoryHit'
import { supplyPayout } from './factoryHit'
import { dirBetween, edgeKey, hexKey, neighbor } from '../hex/math'
import {
  CHIP_ENERGY,
  factoryEffect,
  feeAmount,
  payPlayer,
  supplyResource,
  TIER_LABEL,
  tierAllows,
} from './simRules'
import type {
  Axial,
  CellState,
  Chip,
  ChipColor,
  ChipResource,
  DirIndex,
  MeterKind,
  PlayerId,
  PlayerState,
  Route,
} from '../types'

const SOURCE_RESOURCE: Record<string, ChipResource> = {
  uranium: 'uranium',
  sun: 'light',
  water: 'water',
}

const COLOR_DE: Record<ChipColor, string> = {
  blue: 'blau',
  purple: 'lila',
  red: 'rot',
}

/** Slice of the store the simulation phase reads and writes. */
export interface SimState {
  day: number
  activePlayer: PlayerId
  playerIds: PlayerId[]
  players: Record<PlayerId, PlayerState>
  bank: number
  cells: Record<string, CellState>
  chips: Chip[]
  routes: Record<string, Route>
  log: string[]
  simPasses: number
  simDone: boolean
  simQueue: string[]
  selectedChipId: string | null
  selectedHex: Axial | null
  freibeuters: Freibeuter[]
  /** Fees collected by freibeuters — never spent. */
  piratePurse: number
}

function push(log: string[], day: number, msg: string): string[] {
  return [`T${day}: ${msg}`, ...log].slice(0, 80)
}

function nextSeat(p: PlayerId, seats: PlayerId[]): PlayerId {
  const i = seats.indexOf(p)
  if (i < 0) return seats[0] ?? 1
  return seats[(i + 1) % seats.length]!
}

function payPirate(
  players: Record<PlayerId, PlayerState>,
  purse: number,
  payer: PlayerId,
  fee: number,
): { players: Record<PlayerId, PlayerState>; piratePurse: number } | null {
  if (fee <= 0) return { players, piratePurse: purse }
  if (players[payer].money < fee) return null
  return {
    piratePurse: purse + fee,
    players: {
      ...players,
      [payer]: { ...players[payer], money: players[payer].money - fee },
    },
  }
}


function flying(s: SimState): Chip | undefined {
  return s.chips.find((c) => c.state === 'flying')
}

function chipLabel(chip: Chip): string {
  return `${COLOR_DE[chip.color]} ${resourceName(chip.resource)}`
}

function earn(
  players: Record<PlayerId, PlayerState>,
  bank: number,
  p: PlayerId,
  amount: number,
): { players: Record<PlayerId, PlayerState>; bank: number; note: string } {
  const take = Math.min(bank, amount)
  const extra = amount - take
  return {
    bank: bank - take,
    players: {
      ...players,
      [p]: {
        ...players[p],
        money: players[p].money + take,
        owed: (players[p].owed ?? 0) + extra,
      },
    },
    note:
      extra > 0
        ? ` · Bank leer, ${playerLabel(p)} +${take} bar / +${extra} gutgeschrieben`
        : '',
  }
}

/** Finish one chip. A queued sibling stays in the same turn; otherwise the other player goes. */
function endRouting(s: SimState, patch: Partial<SimState>): Partial<SimState> {
  const chips = patch.chips ?? s.chips
  const queue = (patch.simQueue ?? s.simQueue).filter((id) =>
    chips.some((c) => c.id === id),
  )
  const [nextId, ...rest] = queue
  if (nextId) {
    return {
      ...patch,
      simQueue: rest,
      selectedChipId: nextId,
      chips: chips.map((c) =>
        c.id === nextId ? { ...c, state: 'flying' as const } : c,
      ),
      log: push(
        patch.log ?? s.log,
        s.day,
        'Nächster Chip desselben Simulationszugs.',
      ),
    }
  }
  const next = nextSeat(s.activePlayer, s.playerIds)
  return {
    ...patch,
    simQueue: [],
    simPasses: 0,
    simDone: false,
    activePlayer: next,
    selectedChipId: null,
    log: push(
      patch.log ?? s.log,
      s.day,
      `${playerLabel(next)} ist in der Simulation an der Reihe.`,
    ),
  }
}

function busy(s: SimState): boolean {
  return flying(s) != null || s.simQueue.length > 0
}

export function passSimulation(s: SimState): Partial<SimState> {
  if (s.simDone) {
    return { log: push(s.log, s.day, 'Die Simulation ist schon zu Ende.') }
  }
  if (busy(s)) {
    return {
      log: push(
        s.log,
        s.day,
        'Erst den Chip zu Ende leiten, liefern, einlagern oder abbrechen.',
      ),
    }
  }
  const passes = s.simPasses + 1
  const need = Math.max(2, s.playerIds.length)
  if (passes >= need) {
    return {
      simPasses: passes,
      simDone: true,
      log: push(
        s.log,
        s.day,
        'Alle passen nacheinander. Die Simulation ist zu Ende. Gelagerte Chips bleiben liegen.',
      ),
    }
  }
  const next = nextSeat(s.activePlayer, s.playerIds)
  return {
    simPasses: passes,
    activePlayer: next,
    selectedChipId: null,
    log: push(
      s.log,
      s.day,
      `${playerLabel(s.activePlayer)} passt. ${playerLabel(next)} ist an der Reihe.`,
    ),
  }
}

export function takeSourceChip(
  s: SimState,
  hex: Axial,
  index: number,
  mint: () => string,
): Partial<SimState> {
  if (s.simDone) {
    return { log: push(s.log, s.day, 'Die Simulation ist schon zu Ende.') }
  }
  if (busy(s)) {
    return {
      log: push(s.log, s.day, 'Erst den laufenden Chip abwickeln.'),
    }
  }
  const key = hexKey(hex)
  const cell = s.cells[key]
  const resource = cell ? SOURCE_RESOURCE[cell.terrain] : undefined
  if (!cell?.revealed || !resource) {
    return { log: push(s.log, s.day, 'Keine Quelle auf diesem Feld.') }
  }
  if (cell.sourceOwner == null) {
    return {
      log: push(
        s.log,
        s.day,
        'Neutrale Quellen sind stillgelegt und haben kein Lager.',
      ),
    }
  }
  if (index < 0 || index >= cell.sourceStock.length) {
    return { log: push(s.log, s.day, 'Auf der Quelle liegt kein Chip.') }
  }
  const player = s.activePlayer
  const owner = cell.sourceOwner
  const fee = owner !== player ? feeAmount(cell.sourceFee) : 0
  let players = s.players
  if (fee > 0 && owner) {
    const paid = payPlayer(players, player, owner, fee)
    if (!paid) {
      return {
        log: push(s.log, s.day, `Abbaugebühr ${fee} nicht bezahlbar.`),
      }
    }
    players = paid
  }
  const pirate = pirateFeeAt(s.freibeuters ?? [], hex)
  let piratePurse = s.piratePurse ?? 0
  if (pirate > 0) {
    const paidPirate = payPirate(players, piratePurse, player, pirate)
    if (!paidPirate) {
      return {
        log: push(
          s.log,
          s.day,
          `Freibeutergebühr ${pirate} nicht bezahlbar — Entnahme blockiert.`,
        ),
      }
    }
    players = paidPirate.players
    piratePurse = paidPirate.piratePurse
  }
  const color = cell.sourceStock[index]
  const chip: Chip = {
    id: mint(),
    color,
    state: 'flying',
    hex: { ...hex },
    resource,
    pilot: player,
    seen: { [key]: 1 },
  }
  const feeNote =
    fee > 0
      ? ` ${playerLabel(player)} zahlt ${fee} Abbaugebühr an ${playerLabel(owner)}.`
      : ' Eigene Quelle, keine Gebühr.'
  const pirateNote =
    pirate > 0
      ? ` Freibeuter +${pirate} (Kasse ${piratePurse}).`
      : ''
  return {
    players,
    piratePurse,
    cells: {
      ...s.cells,
      [key]: {
        ...cell,
        sourceStock: cell.sourceStock.filter((_, i) => i !== index),
      },
    },
    chips: [...s.chips, chip],
    selectedChipId: chip.id,
    selectedHex: { ...hex },
    log: push(
      s.log,
      s.day,
      `${playerLabel(player)} entnimmt ${chipLabel(chip)} von (${hex.q},${hex.r}).${feeNote}${pirateNote}`,
    ),
  }
}

export function releaseStoredChip(
  s: SimState,
  hex: Axial,
  mint: () => string,
): Partial<SimState> {
  if (s.simDone) {
    return { log: push(s.log, s.day, 'Die Simulation ist schon zu Ende.') }
  }
  if (busy(s)) {
    return { log: push(s.log, s.day, 'Erst den laufenden Chip abwickeln.') }
  }
  const key = hexKey(hex)
  const cell = s.cells[key]
  const field = cell?.field
  if (!cell?.revealed || field?.kind !== 'pumped') {
    return { log: push(s.log, s.day, 'Kein Speicher auf diesem Feld.') }
  }
  if (field.charge.length === 0) {
    return { log: push(s.log, s.day, 'Der Speicher ist leer.') }
  }
  const holder = field.storedBy ?? field.owner
  if (holder == null || holder !== s.activePlayer) {
    return {
      log: push(
        s.log,
        s.day,
        holder == null
          ? 'Eine neutrale Fabrik speichert nichts.'
          : `Die Ladung gehört ${playerLabel(holder)}.`,
      ),
    }
  }
  const pirate = pirateFeeAt(s.freibeuters ?? [], hex)
  let players = s.players
  let piratePurse = s.piratePurse ?? 0
  if (pirate > 0) {
    const paidPirate = payPirate(players, piratePurse, holder, pirate)
    if (!paidPirate) {
      return {
        log: push(
          s.log,
          s.day,
          `Freibeutergebühr ${pirate} nicht bezahlbar — Freigabe blockiert.`,
        ),
      }
    }
    players = paidPirate.players
    piratePurse = paidPirate.piratePurse
  }
  const color = field.charge[0]
  const resource = field.chargeResource ?? 'water'
  const chip: Chip = {
    id: mint(),
    color,
    state: 'flying',
    hex: { ...hex },
    resource,
    pilot: holder,
    seen: { [key]: 1 },
  }
  const pirateNote =
    pirate > 0
      ? ` Freibeuter +${pirate} (Kasse ${piratePurse}).`
      : ' Die Freigabe kostet nichts.'
  return {
    players,
    piratePurse,
    cells: {
      ...s.cells,
      [key]: {
        ...cell,
        field: {
          ...field,
          charge: [],
          chargeResource: undefined,
          storedBy: undefined,
        },
      },
    },
    chips: [...s.chips, chip],
    selectedChipId: chip.id,
    selectedHex: { ...hex },
    log: push(
      s.log,
      s.day,
      `${playerLabel(holder)} gibt ${chipLabel(chip)} aus dem Speicher frei.${pirateNote}`,
    ),
  }
}

export function routeAlong(s: SimState, dir: DirIndex): Partial<SimState> {
  const chip = flying(s)
  if (!chip) {
    return { log: push(s.log, s.day, 'Kein Chip unterwegs.') }
  }
  const dest = neighbor(chip.hex, dir)
  const route = s.routes[edgeKey(chip.hex, dest)]
  if (!route) {
    return {
      selectedHex: { ...dest },
      log: push(s.log, s.day, 'In diese Richtung gibt es keinen Transportweg.'),
    }
  }
  if (!tierAllows(route.tier, chip.color)) {
    return {
      log: push(
        s.log,
        s.day,
        `Ein ${TIER_LABEL[route.tier]}-Weg trägt keinen ${COLOR_DE[chip.color]}-Chip.`,
      ),
    }
  }
  const payer = chip.pilot ?? s.activePlayer
  const fee = payer === route.owner ? 0 : feeAmount(route.fee)
  let players = s.players
  if (fee > 0) {
    const paid = payPlayer(players, payer, route.owner, fee)
    if (!paid) {
      return {
        log: push(s.log, s.day, `Weggebühr ${fee} nicht bezahlbar.`),
      }
    }
    players = paid
  }
  const pirate = pirateFeeAt(s.freibeuters ?? [], dest)
  let piratePurse = s.piratePurse ?? 0
  if (pirate > 0) {
    const paidPirate = payPirate(players, piratePurse, payer, pirate)
    if (!paidPirate) {
      return {
        log: push(
          s.log,
          s.day,
          `Freibeutergebühr ${pirate} auf (${dest.q},${dest.r}) nicht bezahlbar — Feld gesperrt.`,
        ),
      }
    }
    players = paidPirate.players
    piratePurse = paidPirate.piratePurse
  }
  const visitKey = hexKey(dest)
  const seen = {
    ...(chip.seen ?? {}),
    [visitKey]: (chip.seen?.[visitKey] ?? 0) + 1,
  }
  const feeNote =
    fee > 0
      ? ` ${playerLabel(payer)} zahlt ${fee} an ${playerLabel(route.owner)}.`
      : ''
  const pirateNote =
    pirate > 0
      ? ` Freibeuter +${pirate} (Kasse ${piratePurse}).`
      : ''
  if (seen[visitKey] >= 3) {
    return endRouting(s, {
      players,
      piratePurse,
      chips: s.chips.filter((c) => c.id !== chip.id),
      selectedHex: { ...dest },
      log: push(
        s.log,
        s.day,
        `Endlosschleife: ${chipLabel(chip)} zum dritten Mal auf (${dest.q},${dest.r}) — zurück in den Beutel.${feeNote}${pirateNote}`,
      ),
    })
  }
  const moved: Chip = { ...chip, hex: { ...dest }, seen, state: 'flying' }
  return {
    players,
    piratePurse,
    chips: s.chips.map((c) => (c.id === chip.id ? moved : c)),
    selectedChipId: chip.id,
    selectedHex: { ...dest },
    log: push(
      s.log,
      s.day,
      `${chipLabel(chip)} über ${TIER_LABEL[route.tier]} nach (${dest.q},${dest.r}).${feeNote}${pirateNote}`,
    ),
  }
}

export function triggerFactory(
  s: SimState,
  mint: () => string,
): Partial<SimState> {
  const chip = flying(s)
  if (!chip) return { log: push(s.log, s.day, 'Kein Chip unterwegs.') }
  const key = hexKey(chip.hex)
  const cell = s.cells[key]
  const field = cell?.field
  if (!cell?.revealed || !field) {
    return { log: push(s.log, s.day, 'Keine Fabrik auf diesem Feld.') }
  }
  if (field.owner == null) {
    return {
      log: push(
        s.log,
        s.day,
        'Neutrale Fabrik ist inaktiv. Der Chip kann sie über einen Weg passieren.',
      ),
    }
  }
  const effect = factoryEffect(field, chip)
  if (!effect) {
    return {
      log: push(
        s.log,
        s.day,
        'Kein passender Effekt. Der Chip kann die Fabrik über einen Weg passieren.',
      ),
    }
  }
  const payer = chip.pilot ?? s.activePlayer
  const fee = payer === field.owner ? 0 : feeAmount(field.fee)
  let players = s.players
  if (fee > 0) {
    const paid = payPlayer(players, payer, field.owner, fee)
    if (!paid) {
      return {
        log: push(
          s.log,
          s.day,
          `Verarbeitungsgebühr ${fee} nicht bezahlbar. Der Effekt bleibt aus.`,
        ),
      }
    }
    players = paid
  }
  const feeNote =
    fee > 0
      ? ` ${playerLabel(payer)} zahlt ${fee} an ${playerLabel(field.owner)}.`
      : ' Keine Gebühr.'

  if (effect.type === 'convert') {
    return {
      players,
      chips: s.chips.map((c) =>
        c.id === chip.id ? { ...c, resource: effect.resource } : c,
      ),
      selectedChipId: chip.id,
      log: push(s.log, s.day, `${effect.label}.${feeNote}`),
    }
  }

  if (effect.type === 'store-water' || effect.type === 'store-player') {
    const nextField =
      effect.type === 'store-player'
        ? {
            ...field,
            charge: [chip.color],
            chargeResource: chip.resource,
            storedBy: payer,
          }
        : { ...field, charge: [...field.charge, chip.color] }
    return endRouting(s, {
      players,
      cells: {
        ...s.cells,
        [key]: { ...cell, field: nextField },
      },
      chips: s.chips.filter((c) => c.id !== chip.id),
      log: push(
        s.log,
        s.day,
        `${effect.label} (${COLOR_DE[chip.color]}, ${nextField.charge.length}).${feeNote}`,
      ),
    })
  }

  const released = field.charge[0]
  const extra: Chip = {
    id: mint(),
    color: released,
    state: 'free',
    hex: { ...chip.hex },
    resource: 'voltage',
    pilot: payer,
    seen: { [key]: 1 },
  }
  const updated: Chip =
    effect.type === 'turbine-split' ? { ...chip, resource: 'voltage' } : chip
  return {
    players,
    cells: {
      ...s.cells,
      [key]: {
        ...cell,
        field: { ...field, charge: field.charge.slice(1) },
      },
    },
    chips: [...s.chips.map((c) => (c.id === chip.id ? updated : c)), extra],
    simQueue: [...s.simQueue, extra.id],
    selectedChipId: chip.id,
    log: push(
      s.log,
      s.day,
      `${effect.label}: ${COLOR_DE[updated.color]} und ${COLOR_DE[released]}.${feeNote}`,
    ),
  }
}

export function deliverChip(
  s: SimState,
  payTariff: boolean,
): Partial<SimState> {
  const chip = flying(s)
  if (!chip) return { log: push(s.log, s.day, 'Kein Chip unterwegs.') }
  if (!supplyResource(chip.resource)) {
    return {
      log: push(
        s.log,
        s.day,
        'Licht und Uran können nicht an einen Planeten geliefert werden.',
      ),
    }
  }
  const key = hexKey(chip.hex)
  const cell = s.cells[key]
  if (!cell?.revealed || cell.terrain !== 'planet') {
    return { log: push(s.log, s.day, 'Kein Planet unter dem Chip.') }
  }
  const meter = chip.resource as MeterKind
  const energy = CHIP_ENERGY[chip.color]
  const before = cell[meter]
  const payer = chip.pilot ?? s.activePlayer
  const owner = cell.planetOwner
  const tariff = owner && owner !== payer ? feeAmount(cell.importFee) : 0
  let players = s.players
  if (payTariff && tariff > 0 && owner) {
    const paid = payPlayer(players, payer, owner, tariff)
    if (!paid) {
      return { log: push(s.log, s.day, `Importzoll ${tariff} nicht bezahlbar.`) }
    }
    players = paid
  }
  const hasConsumer = cell.consumers.some((c) => c.type === meter)
  const tariffSettled = tariff === 0 || payTariff
  let bank = s.bank
  let payNote = ' · kein passender Verbraucher'
  if (hasConsumer && tariffSettled) {
    const payout = supplyPayout(before, energy)
    if (payout > 0) {
      const gained = earn(players, bank, payer, payout)
      players = gained.players
      bank = gained.bank
      payNote = ` · ${playerLabel(payer)} +${payout} aus der Bank${gained.note}`
    } else {
      payNote = ` · ${playerLabel(payer)} +0 (Messgerät war ${before})`
    }
  } else if (!tariffSettled) {
    payNote = ' · ohne Zoll, keine Einnahme'
  }
  if (payTariff && tariff > 0 && owner) {
    payNote = ` · Zoll ${tariff} an ${playerLabel(owner)}${payNote}`
  }
  const name = cell.planetName ?? `(${cell.hex.q},${cell.hex.r})`
  return endRouting(s, {
    players,
    bank,
    cells: {
      ...s.cells,
      [key]: { ...cell, [meter]: before + energy },
    },
    chips: s.chips.filter((c) => c.id !== chip.id),
    log: push(
      s.log,
      s.day,
      `${name} +${energy} ${resourceName(meter)} (${COLOR_DE[chip.color]})${payNote}.`,
    ),
  })
}

export function abortTransport(s: SimState): Partial<SimState> {
  const chip = flying(s)
  if (!chip) return { log: push(s.log, s.day, 'Kein Chip unterwegs.') }
  return endRouting(s, {
    chips: s.chips.filter((c) => c.id !== chip.id),
    log: push(s.log, s.day, `${chipLabel(chip)} abgebrochen — zurück in den Beutel.`),
  })
}

export function clickDuringSim(
  s: SimState,
  hex: Axial,
  mint: () => string,
): Partial<SimState> {
  const chip = flying(s)
  if (chip) {
    const dir = dirBetween(chip.hex, hex)
    if (!dir) {
      return {
        selectedHex: { ...hex },
        log: push(s.log, s.day, 'Der Chip zieht nur über einen Weg zum Nachbarfeld.'),
      }
    }
    return routeAlong(s, dir)
  }
  const cell = s.cells[hexKey(hex)]
  if (!cell) return { selectedHex: { ...hex } }
  if (
    SOURCE_RESOURCE[cell.terrain] &&
    cell.sourceOwner != null &&
    cell.sourceStock.length === 1
  ) {
    return takeSourceChip(s, hex, 0, mint)
  }
  if (
    SOURCE_RESOURCE[cell.terrain] &&
    cell.sourceOwner != null &&
    cell.sourceStock.length > 1
  ) {
    return {
      selectedHex: { ...hex },
      log: push(s.log, s.day, 'Mehrere Chips auf der Quelle — im Panel einen wählen.'),
    }
  }
  const field = cell.field
  if (field?.kind === 'pumped' && field.charge.length > 0) {
    const holder = field.storedBy ?? field.owner
    if (holder === s.activePlayer) return releaseStoredChip(s, hex, mint)
  }
  return { selectedHex: { ...hex } }
}
