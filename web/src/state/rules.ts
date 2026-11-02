import type { Card, CellState, Coord, GameState, Rank } from '../types'
import {
  canStackOn,
  isDescendingRun,
  keyOf,
  rankLabel,
  suitSymbol,
} from '../types'
import { createRng } from './rng'
import { findPathVia } from './pathfinding'
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
  return createRng(state.rngSeed + state.logSeq * 9973 + state.turn * 131)
}

function payTransport(
  state: GameState,
  payments: { to: GameState['players'][0]['id'] | 'bank'; amount: number }[],
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

function isEnergyCard(c: Card): boolean {
  return c.suit === 'hearts'
}

/** Neutrale/gegnerische Pik-Verteidigung (Szenario). */
function isDefenseCell(cell: CellState): boolean {
  if (cell.kind !== 'empty') return false
  const bottom = cell.stack[0]
  return Boolean(bottom && bottom.suit === 'spades' && bottom.faceUp)
}

/** Feld mit Gebührenmarker (nur offene Felder, keine Planeten). */
function isFeeCell(cell: CellState): boolean {
  return (
    cell.kind === 'empty' &&
    Boolean(cell.owner) &&
    cell.stack.length > 0
  )
}

/** Offener Energiestapel auf leerem Feld (mit oder ohne Gebühr). */
function isOpenEnergyField(cell: CellState): boolean {
  return (
    cell.kind === 'empty' &&
    cell.stack.length > 0 &&
    cell.stack.every(isEnergyCard)
  )
}

function takeTopRunFrom(cards: Card[], count: number): Card[] | null {
  if (count < 1 || count > cards.length) return null
  const slice = cards.slice(cards.length - count)
  if (!slice.every((c) => c.faceUp)) return null
  if (!isDescendingRun(slice)) return null
  return slice
}

function takeTopRun(cell: CellState, count: number): Card[] | null {
  return takeTopRunFrom(cell.stack, count)
}

function revealFromCell(state: GameState, cell: CellState): void {
  const rng = rngFrom(state)
  if (cell.kind === 'sun') {
    if (cell.stack.length === 0) {
      refillSun(cell, state, rng)
      const top = topCard(cell)
      // Ass aufgedeckt → der aufdeckende Spieler muss Bedarf würfeln.
      if (top && top.suit === 'hearts' && top.rank === 1) {
        applyDemandRoll(state)
      }
    }
  } else {
    revealTopIfNeeded(cell)
  }
}

function clearFeeMarker(cell: CellState): void {
  cell.owner = undefined
  cell.toll = 0
}

/**
 * Bedarf würfeln: W4 pro Planet; 1–3 senken, 4 erhöht um 1; +1 Siegpunkt.
 * Wird ausgelöst, wenn ein Spieler ein Ass auf der Sonne aufdeckt.
 */
function applyDemandRoll(state: GameState): void {
  if (state.ended) return

  const player = currentPlayer(state)
  const rng = rngFrom(state)
  const planets = Object.values(state.cells).filter((c) => c.kind === 'planet')
  const parts: string[] = []

  for (const planet of planets) {
    const roll = Math.floor(rng() * 4) + 1
    if (roll <= 3) {
      planet.tension -= roll
    } else {
      planet.tension += 1
    }
    planet.tension = Math.max(-6, Math.min(6, planet.tension))
    parts.push(`${planet.label ?? 'Planet'} W4=${roll} → ${planet.tension}`)
  }

  player.securedVp += 1

  state.demandRollSeq += 1
  state.demandRollFlash = parts.map((p) => p.replace(' → ', ' → Spannung '))

  log(
    state,
    `${player.name} deckt Ass auf und würfelt Bedarf: ${parts.join('; ')}. (+1◆, jetzt ${player.securedVp}◆)`,
    'tension',
  )

  for (const planet of planets) {
    clampAndClearPlanetTension(state, planet)
  }

  checkEndConditions(state)
}

/** What can be selected on a cell for the current player. */
export function selectableCounts(
  state: GameState,
  x: number,
  y: number,
): number[] {
  const cell = state.cells[keyOf(x, y)]
  if (!cell || state.ended) return []
  const counts: number[] = []

  // Planet energy cannot be taken.
  if (cell.kind === 'planet') return counts

  if (cell.stack.length === 0) return counts

  if (cell.kind === 'sun') {
    const top = topCard(cell)
    if (top?.faceUp && isEnergyCard(top)) counts.push(1)
    return counts
  }

  // Energie nur von eigenen Gebührenfeldern (leere Felder mit eigener Marke).
  const player = currentPlayer(state)
  if (
    cell.kind === 'empty' &&
    cell.owner === player.id &&
    isOpenEnergyField(cell)
  ) {
    for (let c = 1; c <= cell.stack.length; c++) {
      const run = takeTopRun(cell, c)
      if (!run) continue
      if (run.every(isEnergyCard)) counts.push(c)
    }
  }

  return counts
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

  const allEnergy = cards.every(isEnergyCard)
  if (!allEnergy) {
    return { ok: false, reason: 'Nur Energiekarten beweglich' }
  }

  const fromCell = state.cells[keyOf(from.x, from.y)]
  if (fromCell?.kind === 'planet') {
    return { ok: false, reason: 'Energie bleibt auf dem Planeten' }
  }

  if (target.kind === 'planet') {
    const top = topCard(target)
    if (!top) return { ok: true }
    if (canStackOn(stackBottomRank(cards), top.rank)) return { ok: true }
    return { ok: false, reason: 'Passt nicht auf Planet' }
  }

  if (isDefenseCell(target)) {
    const top = topCard(target)!
    if (canStackOn(stackBottomRank(cards), top.rank)) return { ok: true }
    return { ok: false, reason: 'Passt nicht auf Verteidigung' }
  }

  // Leeres Feld oder offener Energiestapel: Zwischenlager / Gebührenfeld.
  if (target.kind === 'empty') {
    if (target.stack.length === 0) return { ok: true }
    if (isOpenEnergyField(target)) {
      const top = topCard(target)!
      if (canStackOn(stackBottomRank(cards), top.rank)) return { ok: true }
      return { ok: false, reason: 'Passt nicht auf Energiestapel' }
    }
    return { ok: false, reason: 'Feld belegt' }
  }

  return { ok: false, reason: 'Kein legales Ziel' }
}

function routePath(
  state: GameState,
  from: Coord,
  to: Coord,
): ReturnType<typeof findPathVia> {
  return findPathVia(
    state,
    from,
    state.waypoints,
    to,
    currentPlayer(state).id,
  )
}

export function previewMove(
  state: GameState,
  to: Coord,
): { path: Coord[]; cost: number; legal: boolean; reason?: string } | null {
  if (!state.selection || state.selection.type !== 'stack') return null
  const { x, y, count } = state.selection
  const from = { x, y }
  const cell = state.cells[keyOf(x, y)]
  const cards = takeTopRunFrom(cell.stack, count)
  if (!cards) return null

  const dest = legalDestination(state, from, cards, to)
  const path = routePath(state, from, to)
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

export function isVacantEmpty(cell: CellState | undefined): boolean {
  return Boolean(cell && cell.kind === 'empty' && cell.stack.length === 0)
}

export function isMoveTarget(state: GameState, to: Coord): boolean {
  if (!state.selection || state.selection.type !== 'stack') return false
  const { x, y, count } = state.selection
  const cell = state.cells[keyOf(x, y)]
  const cards = takeTopRunFrom(cell.stack, count)
  if (!cards) return false
  return legalDestination(state, { x, y }, cards, to).ok
}

export function toggleWaypoint(state: GameState, to: Coord): GameState {
  const next = cloneState(state)
  if (!next.selection || next.ended) return next
  if (!isVacantEmpty(next.cells[keyOf(to.x, to.y)])) return next

  const idx = next.waypoints.findIndex((w) => w.x === to.x && w.y === to.y)
  if (idx >= 0) {
    next.waypoints = next.waypoints.slice(0, idx)
  } else {
    next.waypoints = [...next.waypoints, { x: to.x, y: to.y }]
  }

  const from = { x: next.selection.x, y: next.selection.y }
  if (next.waypoints.length === 0) {
    next.pathPreview = null
    next.pathCost = null
    return next
  }
  const last = next.waypoints[next.waypoints.length - 1]
  const path = findPathVia(
    next,
    from,
    next.waypoints.slice(0, -1),
    last,
    currentPlayer(next).id,
  )
  next.pathPreview = path?.path ?? null
  next.pathCost = path?.totalCost ?? null
  return next
}

function clearSelection(state: GameState): void {
  state.selection = null
  state.waypoints = []
  state.pathPreview = null
  state.pathCost = null
  state.actionError = null
}

function failMove(state: GameState, reason: string): GameState {
  state.actionError = reason
  return state
}

function advanceTurn(state: GameState): void {
  clearSelection(state)
  state.currentPlayerIndex =
    (state.currentPlayerIndex + 1) % state.players.length
  if (state.currentPlayerIndex === 0) state.turn += 1
}

/** Energie, die aus dem Spiel geht → gemeinsame offene Ablage neben dem Spielfeld. */
function discardEnergy(state: GameState, cards: Card[]): void {
  for (const c of cards) {
    if (c.suit !== 'hearts') continue
    state.energyDiscard.push({ ...c, faceUp: true })
  }
}

function clearPlanetStack(
  state: GameState,
  planet: CellState,
  reason: 'ace' | 'limit',
): void {
  const player = currentPlayer(state)
  if (reason === 'ace') {
    log(
      state,
      `${player.name} schließt Versorgung auf ${planet.label ?? 'Planet'} ab. Planet ist wieder leer.`,
      'money',
    )
    if (state.missions && planet.label) {
      if (!state.missions.suppliedPlanets.includes(planet.label)) {
        state.missions.suppliedPlanets.push(planet.label)
      }
    }
  } else {
    const tensionLabel =
      planet.tension > 0 ? `+${planet.tension}` : String(planet.tension)
    const name = planet.label ?? 'Planet'
    state.planetLimitSeq += 1
    state.planetLimitFlash = `${name}: Spannung ${tensionLabel}`
    log(
      state,
      `${name}: Spannung ${tensionLabel} — Stapel wird abgeräumt.`,
      'tension',
    )
  }

  discardEnergy(state, planet.stack)
  planet.stack = []
  clearFeeMarker(planet)
  if (reason === 'limit') planet.tension = 0
}

function completePlanetIfNeeded(state: GameState, planet: CellState): void {
  const top = topCard(planet)
  if (!top || !(top.suit === 'hearts' && top.rank === 1)) return
  clearPlanetStack(state, planet, 'ace')
}

/** Spannung auf −6…+6 begrenzen; bei genau ±6 Stapel abräumen. */
function clampAndClearPlanetTension(state: GameState, planet: CellState): void {
  if (planet.kind !== 'planet') return
  planet.tension = Math.max(-6, Math.min(6, planet.tension))
  if (planet.tension === -6 || planet.tension === 6) {
    clearPlanetStack(state, planet, 'limit')
  }
}

/** Verteidigung abgeräumt, sobald Herz Ass oben liegt. */
function completeDefenseIfNeeded(state: GameState, cell: CellState): void {
  const top = topCard(cell)
  if (!top || !(top.suit === 'hearts' && top.rank === 1)) return
  defeatDefense(state, cell)
}

/**
 * Energiestapel auf leerem Feld: Ass räumt alles ab und entfernt den Gebührenmarker.
 */
function completeOpenEnergyIfNeeded(state: GameState, cell: CellState): void {
  const top = topCard(cell)
  if (!top || !(top.suit === 'hearts' && top.rank === 1)) return
  if (!isOpenEnergyField(cell)) return

  const player = currentPlayer(state)
  log(
    state,
    `${player.name} räumt Energiestapel bei (${cell.x},${cell.y}) mit Ass ab.`,
    'combat',
  )
  discardEnergy(state, cell.stack)
  cell.stack = []
  clearFeeMarker(cell)
}

function defeatDefense(state: GameState, cell: CellState): void {
  const player = currentPlayer(state)
  log(state, `${player.name} besiegt eine Verteidigung!`, 'combat')
  if (state.missions && cell.owner === 'neutral') {
    state.missions.defensesDefeated += 1
  }
  discardEnergy(state, cell.stack)
  cell.stack = []
  clearFeeMarker(cell)
  cell.kind = 'empty'
}

function checkEndConditions(state: GameState): void {
  if (state.ended) return
  if (state.bank <= 0) {
    endGame(state, 'Die Bank ist leer.')
  }
}

function endGame(state: GameState, reason: string): void {
  if (state.ended) return
  state.ended = true
  clearSelection(state)

  if (state.mode === 'versus') {
    const scored = state.players.map((p) => ({
      p,
      score: totalWealth(p),
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
  next.waypoints = []
  next.pathPreview = null
  next.pathCost = null
  next.actionError = null
  return next
}

export function hoverTarget(state: GameState, to: Coord): GameState {
  const next = cloneState(state)
  if (!next.selection) {
    next.pathPreview = null
    next.pathCost = null
    return next
  }
  const preview = previewMove(next, to)
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
  next.actionError = null
  if (next.ended || !next.selection || next.selection.type !== 'stack') {
    return next
  }
  const player = currentPlayer(next)

  const { x, y, count } = next.selection
  const fromCell = next.cells[keyOf(x, y)]
  const cards = takeTopRunFrom(fromCell.stack, count)
  if (!cards) return failMove(next, 'Keine bewegliche Karte')

  const destCheck = legalDestination(next, { x, y }, cards, to)
  if (!destCheck.ok) {
    return failMove(next, destCheck.reason ?? 'Ungültiges Ziel')
  }

  const path = routePath(next, { x, y }, to)
  if (!path) return failMove(next, 'Kein Weg zum Ziel')
  if (player.money < path.totalCost) {
    return failMove(next, `Nicht genug Geld (${path.totalCost}¤)`)
  }
  if (!payTransport(next, path.payments)) {
    return failMove(next, 'Transportkosten können nicht gezahlt werden')
  }

  fromCell.stack = fromCell.stack.slice(0, fromCell.stack.length - count)

  const target = next.cells[keyOf(to.x, to.y)]
  const allEnergy = cards.every(isEnergyCard)
  const fromWasSun = fromCell.kind === 'sun'

  // Gebührenmarker verschwindet, wenn der Energiestapel das Feld verlässt.
  if (
    fromCell.kind === 'empty' &&
    fromCell.stack.length === 0 &&
    fromCell.owner &&
    fromCell.owner !== 'neutral'
  ) {
    clearFeeMarker(fromCell)
  }

  if (allEnergy && target.kind === 'planet') {
    const income = Math.max(0, -target.tension)
    for (const c of cards) {
      target.stack.push(c)
      target.tension += 1
    }
    const paid = payFromBank(next, income)
    log(
      next,
      `${player.name} liefert ${cards.map((c) => suitSymbol(c.suit) + rankLabel(c.rank)).join(' ')} an ${target.label ?? 'Planet'} (−${path.totalCost} / +${paid} Geld, Spannung ${target.tension > 0 ? '+' : ''}${target.tension}).`,
      'money',
    )
    completePlanetIfNeeded(next, target)
    clampAndClearPlanetTension(next, target)
    if (next.bank <= 0) endGame(next, 'Die Bank ist leer.')
  } else if (allEnergy && isDefenseCell(target)) {
    target.stack.push(...cards)
    log(
      next,
      `${player.name} schwächt Verteidigung mit Energie (−${path.totalCost}).`,
      'combat',
    )
    completeDefenseIfNeeded(next, target)
  } else if (allEnergy && target.kind === 'empty') {
    const claimed = target.stack.length === 0 && !target.owner
    target.stack.push(...cards)
    if (claimed) {
      target.owner = player.id
      target.toll = 0
      log(
        next,
        `${player.name} legt Energie auf (${target.x},${target.y}) und setzt Gebührenmarker (−${path.totalCost}).`,
        'combat',
      )
    } else {
      log(
        next,
        `${player.name} legt ${cards.length} Energie auf (${target.x},${target.y}) (−${path.totalCost}).`,
      )
    }
    completeOpenEnergyIfNeeded(next, target)
  } else {
    fromCell.stack.push(...cards)
    return failMove(next, 'Zug konnte nicht ausgeführt werden')
  }

  // Sonne erst nach Auflösung des Zugs aufdecken (z. B. nach Bedarfsbelohnung).
  if (fromWasSun) {
    revealFromCell(next, fromCell)
  }

  if (!next.ended) {
    advanceTurn(next)
    checkEndConditions(next)
  }
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
  if (!cell || cell.owner !== player.id || !isFeeCell(cell)) return next
  cell.toll = Math.max(0, Math.floor(toll))
  log(next, `${player.name} setzt Gebühr auf ${cell.toll}.`)
  return next
}

export function totalWealth(p: {
  money: number
  bankClaims: number
  securedVp: number
}): number {
  return p.money + p.bankClaims + 5 * p.securedVp
}

export function describeCard(c: Card): string {
  return `${suitSymbol(c.suit)}${rankLabel(c.rank)}`
}
