import { CRITICAL_LIMIT } from '../data/boardLayout'
import { FIELD_DEFS, MARKET_ORDER } from '../data/fields'
import {
  METER_LABELS,
  RESOURCE_LABELS,
  playerFull,
  playerLabel,
} from '../data/labels'
import { DIRECTIONS } from '../types'
import { PHASES, useGame } from '../state/gameStore'
import type { ChipColor, ChipResource, MeterKind, PlayerId } from '../types'
import './SidePanel.css'

const COLORS: ChipColor[] = ['blue', 'purple', 'red']
const RESOURCES: ChipResource[] = [
  'voltage',
  'water',
  'heat',
  'uranium',
  'light',
]
const APPROVE_TYPES: MeterKind[] = ['voltage', 'water', 'heat']

export function SidePanel() {
  const day = useGame((s) => s.day)
  const phase = useGame((s) => s.phase)
  const activePlayer = useGame((s) => s.activePlayer)
  const players = useGame((s) => s.players)
  const ships = useGame((s) => s.ships)
  const landscapeDeck = useGame((s) => s.landscapeDeck)
  const bank = useGame((s) => s.bank)
  const orderHolder = useGame((s) => s.orderHolder)
  const shipMoved = useGame((s) => s.shipMoved)
  const tool = useGame((s) => s.tool)
  const placeKind = useGame((s) => s.placeKind)
  const approveType = useGame((s) => s.approveType)
  const selectedHex = useGame((s) => s.selectedHex)
  const selectedChipId = useGame((s) => s.selectedChipId)
  const heldShip = useGame((s) => s.heldShip)
  const chips = useGame((s) => s.chips)
  const cells = useGame((s) => s.cells)
  const lastDice = useGame((s) => s.lastDice)
  const log = useGame((s) => s.log)
  const lost = useGame((s) => s.lost)
  const lossReason = useGame((s) => s.lossReason)
  const gameOver = useGame((s) => s.gameOver)
  const winner = useGame((s) => s.winner)

  const setTool = useGame((s) => s.setTool)
  const setPlaceKind = useGame((s) => s.setPlaceKind)
  const setApproveType = useGame((s) => s.setApproveType)
  const nextPhase = useGame((s) => s.nextPhase)
  const setPhase = useGame((s) => s.setPhase)
  const setActivePlayer = useGame((s) => s.setActivePlayer)
  const adjustMoney = useGame((s) => s.adjustMoney)
  const rollDemand = useGame((s) => s.rollDemand)
  const approveConsumer = useGame((s) => s.approveConsumer)
  const skipShipMove = useGame((s) => s.skipShipMove)
  const adjustMeter = useGame((s) => s.adjustMeter)
  const rollDice = useGame((s) => s.rollDice)
  const drawFromBag = useGame((s) => s.drawFromBag)
  const addStockChip = useGame((s) => s.addStockChip)
  const stepChip = useGame((s) => s.stepChip)
  const setChipDir = useGame((s) => s.setChipDir)
  const setChipResource = useGame((s) => s.setChipResource)
  const landChip = useGame((s) => s.landChip)
  const removeChip = useGame((s) => s.removeChip)
  const applyChipToPlanet = useGame((s) => s.applyChipToPlanet)
  const emitFromSource = useGame((s) => s.emitFromSource)
  const setSourceDir = useGame((s) => s.setSourceDir)
  const reset = useGame((s) => s.reset)
  const undo = useGame((s) => s.undo)
  const pastLen = useGame((s) => s.past.length)

  const selectedChip = chips.find((c) => c.id === selectedChipId)
  const cellKey = selectedHex ? `${selectedHex.q},${selectedHex.r}` : null
  const cell = cellKey ? cells[cellKey] : null
  const phaseMeta = PHASES.find((p) => p.id === phase)!
  const consumerCount = Object.values(cells).reduce(
    (n, c) => n + c.consumers.length,
    0,
  )
  const shipHere =
    selectedHex &&
    (hexEqualsShip(ships[1], selectedHex)
      ? 1
      : hexEqualsShip(ships[2], selectedHex)
        ? 2
        : null)
  const activeShip = ships[activePlayer]
  const onOwnShip =
    selectedHex &&
    selectedHex.q === activeShip.q &&
    selectedHex.r === activeShip.r
  const onOwnedHex =
    cell?.field?.owner === activePlayer ||
    (cell?.terrain === 'planet' && cell.planetOwner === activePlayer)
  const canBuildHere = onOwnShip || onOwnedHex

  const heldLabel = heldShip
    ? `Schiff ${playerLabel(heldShip)} aufgenommen`
    : selectedChipId
      ? 'Chip aufgenommen'
      : null

  return (
    <aside className="side-panel">
      <header className="brand-block">
        <p className="brand-eyebrow">Playtest</p>
        <h1 className="brand-title">Versorgungs-Architekten</h1>
        <p className="brand-sub">
          Tag {day} · Bank {bank} · Stapel {landscapeDeck.length}
        </p>
      </header>

      {lost && (
        <div className="loss-banner" role="alert">
          <strong>Verloren</strong>
          <span>{lossReason}</span>
          <button type="button" className="btn ghost" onClick={reset}>
            Neu starten
          </button>
        </div>
      )}

      {gameOver && !lost && (
        <div className="loss-banner win-banner" role="status">
          <strong>Spielende</strong>
          <span>
            {winner === 'draw'
              ? 'Gleichstand — Gewinn als Team'
              : winner
                ? `${playerFull(winner)} gewinnt`
                : 'Fertig'}
          </span>
          <button type="button" className="btn ghost" onClick={reset}>
            Neu starten
          </button>
        </div>
      )}

      <section className="panel-card">
        <div className="panel-head">
          <h2>Phase</h2>
          <button
            type="button"
            className="btn"
            onClick={nextPhase}
            title="Enter"
            disabled={gameOver}
          >
            Weiter → <kbd className="kbd">Enter</kbd>
          </button>
        </div>
        <div className="phase-track">
          {PHASES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`phase-pill ${p.id === phase ? 'active' : ''}`}
              onClick={() => setPhase(p.id)}
              disabled={gameOver}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="hint">{phaseMeta.hint}</p>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <h2>Spieler</h2>
          <div className="player-toggle">
            {([1, 2] as PlayerId[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`btn compact owner-${p} ${activePlayer === p ? 'active' : ''}`}
                onClick={() => setActivePlayer(p)}
              >
                {playerLabel(p)}
              </button>
            ))}
          </div>
        </div>
        <div className="players-grid">
          {([1, 2] as PlayerId[]).map((p) => (
            <div
              key={p}
              className={`player-col owner-${p} ${activePlayer === p ? 'is-active' : ''}`}
            >
              <div className="stat-row">
                <span>Geld</span>
                <div className="stepper">
                  <button type="button" onClick={() => adjustMoney(p, -1)}>
                    −
                  </button>
                  <strong>
                    {players[p].money}
                    {(players[p].owed ?? 0) > 0
                      ? ` +${players[p].owed}`
                      : ''}
                  </strong>
                  <button type="button" onClick={() => adjustMoney(p, 1)}>
                    +
                  </button>
                </div>
              </div>
              <p className="hint ship-pos">
                Schiff ({ships[p].q},{ships[p].r})
                {shipMoved[p] ? ' · gezogen' : ''}
                {orderHolder === p ? ' · Reihenfolge' : ''}
              </p>
            </div>
          ))}
        </div>
        {phase === 'navigate' && (
          <button
            type="button"
            className="btn ghost"
            style={{ marginTop: '0.4rem' }}
            onClick={skipShipMove}
          >
            Schiff bleibt stehen
          </button>
        )}
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <h2>Bedarf</h2>
          <span className="muted">{consumerCount} Verbr. · W4 · ±{CRITICAL_LIMIT}</span>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={rollDemand}>
            Bedarf würfeln
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <h2>Werkzeuge</h2>
        </div>
        <div className="tool-grid tool-grid-3">
          {(
            [
              ['select', 'Auswählen', 'A'],
              ['place', 'Bauen', 'B'],
              ['remove', 'Entfernen', 'E'],
            ] as const
          ).map(([id, label, hotkey]) => (
            <button
              key={id}
              type="button"
              className={`tool-btn ${tool === id ? 'active' : ''}`}
              title={hotkey ? `Taste ${hotkey}` : undefined}
              onClick={() => setTool(id)}
            >
              {label}
              {hotkey ? <kbd className="kbd">{hotkey}</kbd> : null}
            </button>
          ))}
        </div>

        {tool === 'select' && (
          <p className="hint">
            Objekt anklicken, dann Zielhex. (Chips, Ladungen, Raumschiffe)
            {heldLabel ? ` · ${heldLabel}` : ''}
          </p>
        )}

        {tool === 'remove' && (
          <p className="hint">
            Hex anklicken: Chip → Feld → Verbraucher → Ladung entfernen.
          </p>
        )}

        {tool === 'place' && (
          <>
            {approveType && !canBuildHere && (
              <p className="hint">
                Verbraucher nur auf eigenem Planeten oder mit Raumschiff{' '}
                {playerLabel(activePlayer)} ({activeShip.q},{activeShip.r}).
              </p>
            )}
            <div className="market-grid">
              {(
                [
                  ['voltage', 'Spannung', '#c4a35a'],
                  ['water', 'Wasser', '#4a8fa8'],
                  ['heat', 'Wärme', '#c45c48'],
                ] as const
              ).map(([type, name, accent]) => (
                <button
                  key={type}
                  type="button"
                  className={`market-item ${approveType === type ? 'active' : ''}`}
                  onClick={() => setApproveType(type)}
                  title={`${name}-Verbraucher genehmigen (1 Geld).`}
                >
                  <span className="market-name" style={{ color: accent }}>
                    {name}-Verbr.
                  </span>
                  <span className="market-cost">1💰</span>
                </button>
              ))}
              {MARKET_ORDER.map((kind) => {
                const def = FIELD_DEFS[kind]
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`market-item ${!approveType && placeKind === kind ? 'active' : ''}`}
                    onClick={() => setPlaceKind(kind)}
                    title={def.blurb}
                  >
                    <span className="market-name" style={{ color: def.accent }}>
                      {def.name}
                    </span>
                    <span className="market-cost">{def.cost}💰</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div className="btn-row wrap" style={{ marginTop: '0.5rem' }}>
          <button type="button" className="btn ghost" onClick={() => rollDice()}>
            Würfel{lastDice ? `: ${lastDice}` : ''}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const c = drawFromBag()
              if (selectedHex) addStockChip(selectedHex, c, true)
            }}
          >
            Beutel
          </button>
          {selectedHex &&
            cell?.revealed &&
            ['uranium', 'sun', 'water'].includes(cell.terrain) && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => emitFromSource(selectedHex)}
              >
                Emit Quelle
              </button>
            )}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <h2>Auswahl</h2>
        </div>
        {!selectedHex && !heldLabel && <p className="hint">Hex anklicken…</p>}
        {heldLabel && <p className="hint">{heldLabel} — Ziel wählen.</p>}
        {selectedHex && cell && (
          <div className="selection-block">
            <p className="coord">
              ({selectedHex.q}, {selectedHex.r}) ·{' '}
              {cell.revealed ? cell.terrain : 'unentdeckt'}
              {shipHere ? ` · Schiff ${playerLabel(shipHere)}` : ''}
              {cell.planetOwner
                ? ` · Planet ${playerLabel(cell.planetOwner)}`
                : ''}
            </p>

            {cell.revealed && cell.terrain === 'planet' && (
              <>
                {APPROVE_TYPES.map((meter) => (
                  <div key={meter} className="stat-row">
                    <span>{METER_LABELS[meter]}</span>
                    <div className="stepper">
                      <button
                        type="button"
                        onClick={() => adjustMeter(selectedHex, meter, -1)}
                      >
                        −
                      </button>
                      <strong>{cell[meter]}</strong>
                      <button
                        type="button"
                        onClick={() => adjustMeter(selectedHex, meter, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
                {cell.consumers.length > 0 && (
                  <ul className="consumer-list">
                    {cell.consumers.map((c) => (
                      <li key={c.id}>
                        {METER_LABELS[c.type]} · {playerLabel(c.approver)}
                      </li>
                    ))}
                  </ul>
                )}
                {tool === 'place' && (
                  <div className="btn-row wrap">
                    {APPROVE_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="btn compact"
                        onClick={() => approveConsumer(selectedHex, type)}
                      >
                        + {METER_LABELS[type]}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {cell.revealed &&
              ['uranium', 'sun', 'water'].includes(cell.terrain) && (
                <div className="source-dir-block">
                  <p className="hint">
                    Quellenpfeil {cell.sourceDir ?? '—'} — auf Schiff drehbar
                  </p>
                  <div className="dir-grid">
                    {DIRECTIONS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`dir-btn ${cell.sourceDir === d.id ? 'active' : ''}`}
                        onClick={() => setSourceDir(selectedHex, d.id)}
                      >
                        {d.id} {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {cell.field && (
              <p>
                <strong style={{ color: FIELD_DEFS[cell.field.kind].accent }}>
                  {FIELD_DEFS[cell.field.kind].name}
                </strong>{' '}
                · {playerLabel(cell.field.owner)}
              </p>
            )}

            {cell.revealed && tool === 'select' && (
              <div className="chip-palette">
                <span className="muted">Chip (soft)</span>
                <div className="btn-row wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`chip-btn chip-${c}`}
                      onClick={() => addStockChip(selectedHex, c, true)}
                    >
                      ●
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedChip && (
          <div className="fly-controls">
            <p>
              Chip · {selectedChip.color}
              {selectedChip.resource
                ? ` · ${RESOURCE_LABELS[selectedChip.resource]}`
                : ''}
              {selectedChip.state === 'flying'
                ? ` · Flug ${selectedChip.stepsLeft ?? '—'}`
                : ' · in Hand'}
            </p>
            <div className="btn-row wrap" style={{ marginBottom: '0.4rem' }}>
              {RESOURCES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`btn compact ${selectedChip.resource === r ? 'active' : 'ghost'}`}
                  onClick={() => setChipResource(selectedChip.id, r)}
                >
                  {RESOURCE_LABELS[r]}
                </button>
              ))}
            </div>
            {selectedChip.state === 'flying' && (
              <>
                <div className="dir-grid">
                  {DIRECTIONS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`dir-btn ${selectedChip.dir === d.id ? 'active' : ''}`}
                      onClick={() => setChipDir(selectedChip.id, d.id)}
                    >
                      {d.id} {d.label}
                    </button>
                  ))}
                </div>
                <div className="btn-row wrap">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => stepChip(selectedChip.id)}
                  >
                    1 Schritt
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => landChip(selectedChip.id, 'free')}
                  >
                    Landen
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => applyChipToPlanet(selectedChip.id)}
                  >
                    → Planet
                  </button>
                  <button
                    type="button"
                    className="btn danger compact"
                    onClick={() => removeChip(selectedChip.id)}
                  >
                    Weg
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel-card log-card">
        <div className="panel-head">
          <h2>Log</h2>
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost compact"
              onClick={undo}
              disabled={pastLen === 0}
              title="Strg+Z"
            >
              Undo <kbd className="kbd">Ctrl+Z</kbd>
            </button>
            <button type="button" className="btn ghost compact" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
        <ul className="log-list">
          {log.map((line, i) => (
            <li key={`${i}-${line.slice(0, 12)}`}>{line}</li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

function hexEqualsShip(a: { q: number; r: number }, b: { q: number; r: number }) {
  return a.q === b.q && a.r === b.r
}
