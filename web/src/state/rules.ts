import type {
  Card,
  CellState,
  Coord,
  GameState,
  PlayerId,
  Rank,
} from '../types'
import {
  canStackOn,
  energyPayout,
  isDescendingRun,
  keyOf,
  rankLabel,
  suitSymbol,
} from '../types'
import { createRng } from './rng'
import { findCheapestPath } from './pathfinding'
import { refillSun, revealTopIfNeeded } from './factory'

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function log(
  state: GameState,
  text: string,
  tone: GameState['log'][0]['tone'] = 'info',
): void {
  state.logSeq += 1
  state.log.unshift({ id: state.logSeq, text, tone })
  if (state.log.length > 80) state.log.length = 80
}

function currentPlayer(state: GameState) {
  return state.players[state.currentPlayerIndex]
}

function rngFrom(state: GameState): () => number {
  // Derive ephemeral rng from seed + logSeq so each action is deterministic-ish
  return createRng(state.rngSeed + state.logSeq * 9973 + state.turn * 131)
}

function payTransport(
  state: GameState,
  payments: { to: PlayerId | 'bank'; amount: number }[],
): boolean {
  const player = currentPlayer(state)
  const total = payments.reduce((s, p) => s + p.amount, 0)
  if (player.money < total) return false
  for (const p of payments) {
    player.money -= p.amount
    if (p.to === 'bank') {
      state.bank += p.amount
    } else {
      const other = state.players.find((x) => x.id === p.to)
      if (other) other.money += p.amount
      else state.bank += p.amount
    }
  }
  return true
}

function payFromBank(state: GameState, amount: number): number {
  const player = currentPlayer(state)
  if (amount <= state.bank) {
    state.bank -= amount
    player.money += amount
    return amount
  }
  const paid = state.bank
  const claim = amount - paid
  state.bank = 0
  player.money += paid
  player.bankClaims += claim
  return paid
}

function topCard(cell: CellState): Card | undefined {
  return cell.stack[cell.stack.length - 1]
}

function isDefenseCell(cell: CellState): boolean {
  if (cell.kind !== 'empty') return false
  const bottom = cell.stack[0]
  return Boolean(bottom && bottom.suit === 'spades' && bottom.faceUp)
}

function isEnergyCard(c: Card): boolean {
  return c.suit === 'hearts'
}

function takeTopRun(cell: CellState, count: number): Card[] | null {
  if (count < 1 || count > cell.stack.length) return null
  const slice = cell.stack.slice(cell.stack.length - count)
  if (!slice.every((c) => c.faceUp)) return null
  if (!isDescendingRun(slice)) return null
  return slice
}

/** What can be selected on a cell for the current player. */
export function selectableCounts(
  state: GameState,
  x: number,
  y: number,
): number[] {
  const cell = state.cells[keyOf(x, y)]
  if (!cell || state.ended) return []
  const player = currentPlayer(state)
  const counts: number[] = []

  // VP marker
  if (cell.vpMarkers > 0) {
    // handled separately via selection type
  }

  if (cell.stack.length === 0) return counts

  // Base: only top unit card
  if (cell.kind === 'base' && cell.owner === player.id) {
    const top = topCard(cell)
    if (top?.faceUp) counts.push(1)
    return counts
  }

  // Sun: top energy
  if (cell.kind === 'sun') {
    const top = topCard(cell)
    if (top?.faceUp && isEnergyCard(top)) counts.push(1)
    return counts
  }

  // Defense owned by player: can move defense (+ energy on top) as descending run
  if (isDefenseCell(cell)) {
    if (cell.owner === player.id) {
      for (let c = 1; c <= cell.stack.length; c++) {
        const run = takeTopRun(cell, c)
        if (!run) continue
        // Bottom of moved run must be the defense itself OR energy-only on top
        // Rules: own defense may move with energy if descending. Foreign/neutral cannot move.
        const bottom = run[0]
        if (bottom.suit === 'spades' || bottom.suit === 'hearts') {
          // If taking only energy from own defense, that's weakening removal? No —
          // energy on defense can be moved away as energy stack.
          counts.push(c)
        }
      }
    } else {
      // Foreign/neutral: can take energy off the top (to weaken elsewhere? actually
      // energy on defense stays until attack — but rules say offen liegende Energie
      // darf unabhängig bewegt werden)
      for (let c = 1; c <= cell.stack.length; c++) {
        const run = takeTopRun(cell, c)
        if (!run) continue
        if (run.every(isEnergyCard)) counts.push(c)
      }
    }
    return counts
  }

  // Planet: can remove energy (for VP) or... energy is delivered, only remove for VP
  if (cell.kind === 'planet') {
    for (let c = 1; c <= cell.stack.length; c++) {
      const run = takeTopRun(cell, c)
      if (run && run.every(isEnergyCard)) counts.push(c)
    }
    return counts
  }

  // Storage / empty with energy or offensive unit
  if (cell.kind === 'storage' || cell.kind === 'empty') {
    for (let c = 1; c <= cell.stack.length; c++) {
      const run = takeTopRun(cell, c)
      if (!run) continue
      if (run.every(isEnergyCard)) {
        counts.push(c)
        continue
      }
      // Offensive unit alone (owned — diamonds have no owner marker; ownership by who played?
      // Rules: units only moved by owner. We tag via cell.owner for units on empty fields.
      if (
        c === 1 &&
        run[0].suit === 'diamonds' &&
        cell.owner === player.id
      ) {
        counts.push(1)
      }
    }
  }

  return counts
}

export function canSelectVp(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[keyOf(x, y)]
  return Boolean(cell && cell.vpMarkers > 0 && !state.ended)
}

function stackBottomRank(cards: Card[]): Rank {
  return cards[0].rank
}

function legalDestination(
  state: GameState,
  from: Coord,
  cards: Card[],
  to: Coord,
): { ok: boolean; reason?: string } {
  if (from.x === to.x && from.y === to.y) {
    return { ok: false, reason: 'Gleiches Feld' }
  }
  const target = state.cells[keyOf(to.x, to.y)]
  if (!target) return { ok: false, reason: 'Außerhalb' }
  if (target.kind === 'asteroid') {
    return { ok: false, reason: 'Asteroid ist kein Ziel' }
  }

  const player = currentPlayer(state)
  const moving = cards
  const allEnergy = moving.every(isEnergyCard)
  const isOffensive = moving.length === 1 && moving[0].suit === 'diamonds'
  const isDefensive =
    moving[0].suit === 'spades' &&
    (moving.length === 1 || moving.slice(1).every(isEnergyCard))

  // VP handled elsewhere

  if (isOffensive) {
    if (isDefenseCell(target)) {
      const top = topCard(target)!
      if (canStackOn(moving[0].rank, top.rank)) return { ok: true }
      return { ok: false, reason: 'Angriff passt nicht' }
    }
    if (target.stack.length === 0 && target.kind === 'empty') return { ok: true }
    return { ok: false, reason: 'Offensive nur auf leere Felder oder Verteidigung' }
  }

  if (isDefensive && moving[0].suit === 'spades') {
    if (target.stack.length === 0 && target.kind === 'empty') return { ok: true }
    return { ok: false, reason: 'Verteidigung nur auf leeres Feld' }
  }

  if (allEnergy) {
    const fromCell = state.cells[keyOf(from.x, from.y)]
    // Energy on planets is harvested into VP markers, not relocated.
    if (fromCell?.kind === 'planet') {
      return { ok: false, reason: 'Planetenergie → Siegpunkte erzeugen' }
    }
    if (target.kind === 'storage') {
      if (target.stack.length === 0) return { ok: true }
      const top = topCard(target)!
      if (canStackOn(stackBottomRank(moving), top.rank)) return { ok: true }
      return { ok: false, reason: 'Passt nicht auf Speicher' }
    }
    if (target.kind === 'planet') {
      const top = topCard(target)
      if (!top) return { ok: false, reason: 'Planet ohne Bedarf' }
      if (canStackOn(stackBottomRank(moving), top.rank)) return { ok: true }
      return { ok: false, reason: 'Passt nicht auf Planet' }
    }
    if (isDefenseCell(target)) {
      const top = topCard(target)!
      if (canStackOn(stackBottomRank(moving), top.rank)) return { ok: true }
      return { ok: false, reason: 'Passt nicht auf Verteidigung' }
    }
    return { ok: false, reason: 'Energie braucht Speicher, Planet oder Verteidigung' }
  }

  // From base deploying unit
  const fromCell = state.cells[keyOf(from.x, from.y)]
  if (fromCell?.kind === 'base' && fromCell.owner === player.id) {
    const unit = moving[0]
    if (unit.suit === 'spades') {
      if (target.stack.length === 0 && target.kind === 'empty') return { ok: true }
      return { ok: false, reason: 'Verteidigung auf leeres Feld' }
    }
    if (unit.suit === 'diamonds') {
      if (target.stack.length === 0 && target.kind === 'empty') return { ok: true }
      if (isDefenseCell(target)) {
        const top = topCard(target)!
        if (canStackOn(unit.rank, top.rank)) return { ok: true }
      }
      return { ok: false, reason: 'Offensive: leer oder Angriff' }
    }
  }

  return { ok: false, reason: 'Kein legales Ziel' }
}

export function previewMove(
  state: GameState,
  to: Coord,
): { path: Coord[]; cost: number; legal: boolean; reason?: string } | null {
  if (!state.selection || state.selection.type !== 'stack') return null
  const { x, y, count } = state.selection
  const from = { x, y }
  const cell = state.cells[keyOf(x, y)]
  const cards = takeTopRun(cell, count)
  if (!cards) return null

  const dest = legalDestination(state, from, cards, to)
  const path = findCheapestPath(state, from, to, currentPlayer(state).id)
  if (!path) return { path: [], cost: 0, legal: false, reason: 'Kein Weg' }

  const afford = currentPlayer(state).money >= path.totalCost
  if (!dest.ok) {
    return { path: path.path, cost: path.totalCost, legal: false, reason: dest.reason }
  }
  if (!afford) {
    return {
      path: path.path,
      cost: path.totalCost,
      legal: false,
      reason: 'Nicht genug Geld',
    }
  }
  return { path: path.path, cost: path.totalCost, legal: true }
}

export function previewVpMove(
  state: GameState,
  to: Coord,
): { path: Coord[]; cost: number; legal: boolean; reason?: string } | null {
  if (!state.selection || state.selection.type !== 'vp') return null
  const from = { x: state.selection.x, y: state.selection.y }
  const player = currentPlayer(state)
  const target = state.cells[keyOf(to.x, to.y)]
  if (!target || target.kind !== 'base' || target.owner !== player.id) {
    const path = findCheapestPath(state, from, to, player.id)
    return {
      path: path?.path ?? [],
      cost: path?.totalCost ?? 0,
      legal: false,
      reason: 'Siegpunkt nur zur eigenen Basis',
    }
  }
  const path = findCheapestPath(state, from, to, player.id)
  if (!path) return { path: [], cost: 0, legal: false, reason: 'Kein Weg' }
  if (player.money < path.totalCost) {
    return {
      path: path.path,
      cost: path.totalCost,
      legal: false,
      reason: 'Nicht genug Geld',
    }
  }
  return { path: path.path, cost: path.totalCost, legal: true }
}

function clearSelection(state: GameState): void {
  state.selection = null
  state.pathPreview = null
  state.pathCost = null
}

function advanceTurn(state: GameState): void {
  clearSelection(state)
  state.currentPlayerIndex =
    (state.currentPlayerIndex + 1) % state.players.length
  if (state.currentPlayerIndex === 0) state.turn += 1
}

function completePlanetIfNeeded(state: GameState, planet: CellState): void {
  const top = topCard(planet)
  if (!top || !(top.suit === 'hearts' && top.rank === 1)) return

  const player = currentPlayer(state)
  log(
    state,
    `${player.name} schließt Versorgung auf ${planet.label ?? 'Planet'} ab.`,
    'money',
  )

  if (state.missions && planet.label) {
    if (!state.missions.suppliedPlanets.includes(planet.label)) {
      state.missions.suppliedPlanets.push(planet.label)
    }
  }

  // Clubs to demand discard, hearts to energy discard
  for (const c of planet.stack) {
    if (c.suit === 'clubs') state.demandDiscard.push(c)
    else state.energyDiscard.push({ ...c, faceUp: false })
  }
  planet.stack = []

  const next = state.demandDeck.pop()
  if (!next) {
    endGame(state, 'Bedarfsvorrat aufgebraucht.')
    return
  }
  next.faceUp = true
  planet.stack = [next]
}

function defeatDefense(state: GameState, cell: CellState): void {
  const player = currentPlayer(state)
  log(state, `${player.name} besiegt eine Verteidigung!`, 'combat')
  if (state.missions && cell.owner === 'neutral') {
    state.missions.defensesDefeated += 1
  }
  for (const c of cell.stack) {
    if (c.suit === 'hearts') state.energyDiscard.push({ ...c, faceUp: false })
    // units leave play for playtest simplicity
  }
  cell.stack = []
  cell.owner = undefined
  cell.toll = 0
  cell.kind = 'empty'
}

function checkEndConditions(state: GameState): void {
  if (state.ended) return
  if (state.bank <= 0) {
    // Bank empty after payout already handled; if bank is 0, game ends
    endGame(state, 'Die Bank ist leer.')
    return
  }
}

function endGame(state: GameState, reason: string): void {
  if (state.ended) return
  state.ended = true
  clearSelection(state)

  if (state.mode === 'versus') {
    const scored = state.players.map((p) => ({
      p,
      score: p.money + p.bankClaims + 5 * p.securedVp,
    }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0].score
    const winners = scored.filter((s) => s.score === best)
    state.winnerText =
      winners.length > 1
        ? `Unentschieden: ${winners.map((w) => w.p.name).join(', ')} (${best}). ${reason}`
        : `${winners[0].p.name} gewinnt mit Gesamtvermögen ${best}. ${reason}`
  } else if (state.missions) {
    const planetsOk = state.missions.requiredPlanets.every((pl) =>
      state.missions!.suppliedPlanets.includes(pl),
    )
    const defOk =
      state.missions.defensesDefeated >= state.missions.requiredDefenses
    if (planetsOk && defOk) {
      state.winnerText = `Mission erfüllt! ${reason}`
    } else {
      state.winnerText = `Mission gescheitert. ${reason}`
    }
  } else {
    state.winnerText = reason
  }
  log(state, state.winnerText, 'end')
}

export function selectStack(
  state: GameState,
  x: number,
  y: number,
  count: number,
): GameState {
  const next = cloneState(state)
  if (next.ended) return next
  const allowed = selectableCounts(next, x, y)
  if (!allowed.includes(count)) {
    clearSelection(next)
    return next
  }
  next.selection = { type: 'stack', x, y, count }
  next.pathPreview = null
  next.pathCost = null
  return next
}

export function selectVp(state: GameState, x: number, y: number): GameState {
  const next = cloneState(state)
  if (!canSelectVp(next, x, y)) {
    clearSelection(next)
    return next
  }
  next.selection = { type: 'vp', x, y }
  next.pathPreview = null
  next.pathCost = null
  return next
}

export function hoverTarget(state: GameState, to: Coord): GameState {
  const next = cloneState(state)
  if (!next.selection) {
    next.pathPreview = null
    next.pathCost = null
    return next
  }
  const preview =
    next.selection.type === 'vp'
      ? previewVpMove(next, to)
      : previewMove(next, to)
  if (!preview) {
    next.pathPreview = null
    next.pathCost = null
    return next
  }
  next.pathPreview = preview.path
  next.pathCost = preview.cost
  return next
}

export function executeMove(state: GameState, to: Coord): GameState {
  const next = cloneState(state)
  if (next.ended || !next.selection) return next
  const player = currentPlayer(next)

  if (next.selection.type === 'vp') {
    const preview = previewVpMove(next, to)
    if (!preview?.legal) return next
    const fromCell = next.cells[keyOf(next.selection.x, next.selection.y)]
    const path = findCheapestPath(
      next,
      { x: next.selection.x, y: next.selection.y },
      to,
      player.id,
    )!
    if (!payTransport(next, path.payments)) return next
    fromCell.vpMarkers -= 1
    player.securedVp += 1
    log(
      next,
      `${player.name} sichert einen Siegpunkt (−${path.totalCost} Geld).`,
      'vp',
    )
    advanceTurn(next)
    checkEndConditions(next)
    return next
  }

  const { x, y, count } = next.selection
  const fromCell = next.cells[keyOf(x, y)]
  const cards = takeTopRun(fromCell, count)
  if (!cards) return next

  const destCheck = legalDestination(next, { x, y }, cards, to)
  if (!destCheck.ok) return next

  const path = findCheapestPath(next, { x, y }, to, player.id)
  if (!path || player.money < path.totalCost) return next
  if (!payTransport(next, path.payments)) return next

  // Remove from source
  fromCell.stack = fromCell.stack.slice(0, fromCell.stack.length - count)

  // Special: removing energy from planet → create VP instead of moving
  if (fromCell.kind === 'planet' && cards.every(isEnergyCard)) {
    // If destination is not used for planet remove — planet remove is a different action
    // that doesn't move to a destination. Handled in removePlanetEnergy().
  }

  const target = next.cells[keyOf(to.x, to.y)]
  const allEnergy = cards.every(isEnergyCard)
  const deployingFromBase = fromCell.kind === 'base'
  const movingDefense = cards[0].suit === 'spades'

  // Reveal sun/base after taking
  if (fromCell.kind === 'sun') {
    refillSun(fromCell, next, rngFrom(next))
  } else if (fromCell.kind === 'base') {
    revealTopIfNeeded(fromCell)
  } else if (isDefenseCell(fromCell) && fromCell.stack.length === 0) {
    // shouldn't happen if we moved the defense itself
  }

  // Clear owner if we moved unit off empty field
  if (
    fromCell.kind === 'empty' &&
    fromCell.stack.length === 0 &&
    fromCell.owner &&
    fromCell.owner !== 'neutral'
  ) {
    fromCell.owner = undefined
    fromCell.toll = 0
  }

  if (allEnergy && target.kind === 'planet') {
    let income = 0
    for (const c of cards) {
      target.stack.push(c)
      income += energyPayout(c.rank)
    }
    const paid = payFromBank(next, income)
    log(
      next,
      `${player.name} liefert ${cards.map((c) => suitSymbol(c.suit) + rankLabel(c.rank)).join(' ')} an ${target.label ?? 'Planet'} (−${path.totalCost} / +${paid} Geld).`,
      'money',
    )
    completePlanetIfNeeded(next, target)
    if (next.bank <= 0) endGame(next, 'Die Bank ist leer.')
  } else if (allEnergy && target.kind === 'storage') {
    target.stack.push(...cards)
    log(
      next,
      `${player.name} speichert ${cards.length} Energie (−${path.totalCost}).`,
    )
  } else if (allEnergy && isDefenseCell(target)) {
    target.stack.push(...cards)
    log(
      next,
      `${player.name} schwächt Verteidigung mit Energie (−${path.totalCost}).`,
      'combat',
    )
  } else if (
    cards.length === 1 &&
    cards[0].suit === 'diamonds' &&
    isDefenseCell(target)
  ) {
    target.stack.push(cards[0])
    defeatDefense(next, target)
  } else if (
    (cards[0].suit === 'diamonds' || movingDefense || deployingFromBase) &&
    target.kind === 'empty' &&
    target.stack.length === 0
  ) {
    target.stack.push(...cards)
    if (cards[0].suit === 'spades') {
      target.owner = player.id
      // Keep toll if moving existing defense, else 0
      if (!(movingDefense && fromCell.owner === player.id)) {
        target.toll = fromCell.owner === player.id ? fromCell.toll : 0
      } else {
        target.toll = fromCell.toll
        fromCell.toll = 0
        fromCell.owner = undefined
      }
      if (deployingFromBase) target.toll = 0
      log(
        next,
        `${player.name} setzt Verteidigung ${suitSymbol('spades')}${rankLabel(cards[0].rank)} (−${path.totalCost}).`,
        'combat',
      )
    } else {
      target.owner = player.id
      log(
        next,
        `${player.name} setzt Offensive ${suitSymbol('diamonds')}${rankLabel(cards[0].rank)} (−${path.totalCost}).`,
        'combat',
      )
    }
  } else if (movingDefense && target.kind === 'empty') {
    target.stack.push(...cards)
    target.owner = player.id
    target.toll = fromCell.toll
    fromCell.toll = 0
    fromCell.owner = undefined
    log(next, `${player.name} bewegt Verteidigung (−${path.totalCost}).`, 'combat')
  } else {
    // fallback: put cards back if somehow invalid
    fromCell.stack.push(...cards)
    return state
  }

  advanceTurn(next)
  checkEndConditions(next)
  return next
}

/** Remove energy from planet to create VP markers (one action). */
export function removePlanetEnergy(
  state: GameState,
  x: number,
  y: number,
  count: number,
): GameState {
  const next = cloneState(state)
  if (next.ended) return next
  const cell = next.cells[keyOf(x, y)]
  if (!cell || cell.kind !== 'planet') return next
  const cards = takeTopRun(cell, count)
  if (!cards || !cards.every(isEnergyCard)) return next

  cell.stack = cell.stack.slice(0, cell.stack.length - count)
  for (const c of cards) {
    next.energyDiscard.push({ ...c, faceUp: false })
  }
  cell.vpMarkers += cards.length
  const player = currentPlayer(next)
  log(
    next,
    `${player.name} erzeugt ${cards.length} Siegpunktmarker auf ${cell.label ?? 'Planet'}.`,
    'vp',
  )
  advanceTurn(next)
  return next
}

export function setToll(
  state: GameState,
  x: number,
  y: number,
  toll: number,
): GameState {
  const next = cloneState(state)
  const player = currentPlayer(next)
  const cell = next.cells[keyOf(x, y)]
  if (!cell || cell.owner !== player.id || !isDefenseCell(cell)) return next
  cell.toll = Math.max(0, Math.floor(toll))
  log(next, `${player.name} setzt Gebühr auf ${cell.toll}.`)
  return next
}

export function passTurn(state: GameState): GameState {
  const next = cloneState(state)
  if (next.ended) return next
  log(next, `${currentPlayer(next).name} setzt aus.`)
  advanceTurn(next)
  return next
}

export function totalWealth(p: { money: number; bankClaims: number; securedVp: number }): number {
  return p.money + p.bankClaims + 5 * p.securedVp
}

export function describeCard(c: Card): string {
  return `${suitSymbol(c.suit)}${rankLabel(c.rank)}`
}
