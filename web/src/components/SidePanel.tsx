import { useState } from 'react'
import {
  CRITICAL_LIMIT,
  describeDeck,
  ZONE_LABELS,
  ZONE_ORDER,
  zoneOf,
} from '../data/boardLayout'
import { FIELD_DEFS, MARKET_ORDER } from '../data/fields'
import {
  METER_LABELS,
  RESOURCE_LABELS,
  playerFull,
  playerLabel,
} from '../data/labels'
import { hexDistance } from '../hex/math'
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
  const landscapeDecks = useGame((s) => s.landscapeDecks)
  const bank = useGame((s) => s.bank)
  const orderHolder = useGame((s) => s.orderHolder)
  const actionsLeft = useGame((s) => s.actionsLeft)
  const tool = useGame((s) => s.tool)
  const placeKind = useGame((s) => s.placeKind)
  const approveType = useGame((s) => s.approveType)
  const developingSource = useGame((s) => s.developingSource)
  const buildAimHex = useGame((s) => s.buildAimHex)
  const draftFee = useGame((s) => s.draftFee)
  const pendingHit = useGame((s) => s.pendingHit)
  const upkeepPlayer = useGame((s) => s.upkeepPlayer)
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
  const setDevelopingSource = useGame((s) => s.setDevelopingSource)
  const nextPhase = useGame((s) => s.nextPhase)
  const setPhase = useGame((s) => s.setPhase)
  const setActivePlayer = useGame((s) => s.setActivePlayer)
  const adjustMoney = useGame((s) => s.adjustMoney)
  const rollDemand = useGame((s) => s.rollDemand)
  const approveConsumer = useGame((s) => s.approveConsumer)
  const endActions = useGame((s) => s.endActions)
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
  const setDraftFee = useGame((s) => s.setDraftFee)
  const setFactoryFee = useGame((s) => s.setFactoryFee)
  const confirmFactoryHit = useGame((s) => s.confirmFactoryHit)
  const declineFactoryHit = useGame((s) => s.declineFactoryHit)
  const pickNuclearColor = useGame((s) => s.pickNuclearColor)
  const releaseStorage = useGame((s) => s.releaseStorage)
  const closeForUpkeep = useGame((s) => s.closeForUpkeep)
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
  const nextActor: PlayerId = activePlayer === 1 ? 2 : 1
  const handsOff = (actionsLeft[nextActor] ?? 0) > 0
  const nearOwnShip =
    selectedHex != null && hexDistance(activeShip, selectedHex) <= 1
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
          Tag {day} · Bank {bank}
        </p>
        <ul className="zone-decks">
          {ZONE_ORDER.map((zone) => {
            const deck = landscapeDecks?.[zone] ?? []
            return (
              <li key={zone}>
                <span className={`zone-swatch zone-swatch-${zone}`} />
                <span className="zone-name">{ZONE_LABELS[zone]}</span>
                <span className="zone-count">{deck.length}</span>
                <span className="zone-mix">{describeDeck(deck)}</span>
              </li>
            )
          })}
        </ul>
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
            title="Leertaste oder Enter"
            disabled={gameOver || upkeepPlayer != null}
          >
            Weiter → <kbd className="kbd">Leertaste</kbd>
            <kbd className="kbd">Enter</kbd>
          </button>
        </div>
        <div className="phase-track">
          {PHASES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`phase-pill ${p.id === phase ? 'active' : ''}`}
              onClick={() => setPhase(p.id)}
              disabled={gameOver || upkeepPlayer != null}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="hint">{phaseMeta.hint}</p>
      </section>

      {upkeepPlayer && (
        <section className="panel-card">
          <div className="panel-head">
            <h2>Unterhalt</h2>
          </div>
          <p className="hint">
            {playerLabel(upkeepPlayer)} hat {players[upkeepPlayer].money} Geld
            und{' '}
            {
              Object.values(cells).filter(
                (c) => c.field?.owner === upkeepPlayer,
              ).length
            }{' '}
            Fabriken. Schließe welche, bis der Rest bezahlbar ist. Die
            markierten Fabriken auf dem Feld tun dasselbe.
          </p>
          <div className="btn-row wrap">
            {Object.values(cells)
              .filter((c) => c.field?.owner === upkeepPlayer)
              .map((c) => (
                <button
                  key={`${c.hex.q},${c.hex.r}`}
                  type="button"
                  className="btn danger compact"
                  onClick={() => closeForUpkeep(c.hex)}
                >
                  {FIELD_DEFS[c.field!.kind].name} ({c.hex.q},{c.hex.r}){' '}
                  schließen
                </button>
              ))}
          </div>
        </section>
      )}

      <section className="panel-card">
        <div className="panel-head">
          <h2>Spieler</h2>
          <div className="player-toggle">
            {([1, 2] as PlayerId[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`btn compact owner-${p} ${activePlayer === p ? 'active' : ''}`}
                onClick={() => {
                  if (phase !== 'act') setActivePlayer(p)
                }}
                disabled={phase === 'act'}
                title={
                  phase === 'act'
                    ? `In der Aktionsphase beginnt ${playerLabel(orderHolder)}.`
                    : undefined
                }
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
                {phase === 'act' ? ` · ${actionsLeft[p] ?? 0} AP` : ''}
                {orderHolder === p ? ' · Reihenfolge' : ''}
              </p>
            </div>
          ))}
        </div>
        {phase === 'act' && (
          <>
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: '0.4rem' }}
              onClick={endActions}
            >
              Aktionen beenden
            </button>
            <p className="hint">
              {handsOff
                ? `Gibt an ${playerLabel(nextActor)} ab. Übrige Punkte verfallen.`
                : 'Übrige Punkte verfallen. Weiter startet die Simulation.'}
            </p>
          </>
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
              ['fee', 'Gebühr', 'G'],
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

        {tool === 'fee' && (
          <>
            <p className="hint">
              Gebühr wählen, dann die eigene Fabrik anklicken. Das Schiff muss
              darauf oder daneben stehen. Kostet 1 Aktionspunkt und kein Geld.
            </p>
            <div className="stat-row">
              <span>Gebühr</span>
              <div className="stepper">
                <button type="button" onClick={() => setDraftFee(draftFee - 1)}>
                  −
                </button>
                <strong>{draftFee}</strong>
                <button type="button" onClick={() => setDraftFee(draftFee + 1)}>
                  +
                </button>
              </div>
            </div>
          </>
        )}

        {tool === 'remove' && (
          <p className="hint">
            Hex anklicken: Chip → Fabrik → Verbraucher → Ladung → Erschließung. Eine eigene Fabrik abbauen kostet 1 Aktionspunkt und kein Geld. Das Schiff steht auf der Fabrik oder daneben.
          </p>
        )}

        {tool === 'place' && (
          <>
            {approveType && !nearOwnShip && (
              <p className="hint">
                Verbraucher nur, wenn das Schiff von {playerLabel(activePlayer)}{' '}
                auf dem Planeten oder daneben steht ({activeShip.q},{activeShip.r}).
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
                  title={`${name}-Verbraucher genehmigen: 1 Geld und 1 Aktionspunkt, Schiff auf dem Planeten oder daneben.`}
                >
                  <span className="market-name" style={{ color: accent }}>
                    {name}-Verbr.
                  </span>
                  <span className="market-cost">1💰</span>
                </button>
              ))}
              <button
                type="button"
                className={`market-item ${developingSource ? 'active' : ''}`}
                onClick={() => setDevelopingSource()}
                title="Quelle erschließen oder eigene Quelle oder Fabrik ausrichten: 1 Geld und 1 Aktionspunkt. Das Schiff steht auf dem Feld oder daneben."
              >
                <span className="market-name" style={{ color: '#d7c48a' }}>
                  Quelle erschließen
                </span>
                <span className="market-cost">1💰</span>
              </button>
              {MARKET_ORDER.map((kind) => {
                const def = FIELD_DEFS[kind]
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`market-item ${!approveType && !developingSource && placeKind === kind ? 'active' : ''}`}
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
            {!developingSource && !approveType && (
              <div className="stat-row">
                <span>Gebühr</span>
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() => setDraftFee(draftFee - 1)}
                  >
                    −
                  </button>
                  <strong>{draftFee}</strong>
                  <button
                    type="button"
                    onClick={() => setDraftFee(draftFee + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
            {buildAimHex && (
              <p className="hint">
                Pfeil für {FIELD_DEFS[placeKind].name} auf ({buildAimHex.q},{' '}
                {buildAimHex.r}) wählen. Der Pfeil gehört zum Bau.
              </p>
            )}
            {developingSource && (
              <p className="hint">
                Sechs Pfeile liegen auf dem Feld des Schiffs und auf den
                Nachbarfeldern. Ein Pfeil kostet 1 Geld und 1 Aktionspunkt.
              </p>
            )}
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
                disabled={!cell.sourceOwner || cell.sourceDir == null}
                title={
                  cell.sourceOwner
                    ? 'Chip entlang des Pfeils abfeuern'
                    : 'Unerschlossen — emittiert nicht'
                }
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
              ({selectedHex.q}, {selectedHex.r}) · {ZONE_LABELS[zoneOf(selectedHex)]} ·{' '}
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
                {tool === 'place' && nearOwnShip && (
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

            {cell.revealed && isSourceTerrain(cell.terrain) && (
              <SourceAim
                cell={cell}
                phase={phase}
                activePlayer={activePlayer}
                inRange={hexDistance(ships[activePlayer], selectedHex) <= 1}
                money={players[activePlayer].money}
                picking={developingSource}
              />
            )}

            {cell.field && (
              <p>
                <strong style={{ color: FIELD_DEFS[cell.field.kind].accent }}>
                  {FIELD_DEFS[cell.field.kind].name}
                </strong>{' '}
                · {playerLabel(cell.field.owner)}
                {cell.field.dir
                  ? ` · Pfeil ${cell.field.dir} ${DIRECTIONS[cell.field.dir - 1].label}`
                  : ' · noch kein Pfeil'}
                {` · Gebühr ${cell.field.fee ?? 0}`}
              </p>
            )}
            {cell.field &&
              phase === 'act' &&
              cell.field.owner === activePlayer &&
              nearOwnShip &&
              selectedHex && (
                <FactoryFee
                  key={cell.field.fee ?? 0}
                  current={cell.field.fee ?? 0}
                  onCommit={(fee) => setFactoryFee(selectedHex, fee)}
                />
              )}
            {cell.field?.kind === 'pumped' &&
              phase === 'simulate' &&
              cell.field.owner === activePlayer &&
              cell.field.charge.length > 0 &&
              selectedHex && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => releaseStorage(selectedHex)}
                >
                  Ladung in Pfeilrichtung schießen
                </button>
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
                {pendingHit?.chipId === selectedChip.id &&
                  pendingHit.mode === 'fee' && (
                    <div className="btn-row wrap">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => confirmFactoryHit()}
                      >
                        Gebühr zahlen
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => declineFactoryHit()}
                      >
                        Geradeaus
                      </button>
                    </div>
                  )}
                {pendingHit?.chipId === selectedChip.id &&
                  pendingHit.mode === 'ship' && (
                    <>
                      <p className="hint">
                        Feld auslösen berechnet die Gebühr. Eine Richtung leitet
                        ohne Gebühr um.
                      </p>
                      <div className="btn-row wrap">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => confirmFactoryHit()}
                        >
                          Feld auslösen
                        </button>
                      </div>
                    </>
                  )}
                {pendingHit?.chipId === selectedChip.id &&
                  pendingHit.mode === 'color' && (
                    <div className="btn-row wrap">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`chip-btn chip-${c}`}
                          onClick={() => pickNuclearColor(c)}
                        >
                          ●
                        </button>
                      ))}
                    </div>
                  )}
                {(pendingHit?.chipId !== selectedChip.id ||
                  pendingHit.mode === 'ship') && (
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
                  )}
                <div className="btn-row wrap">
                  {pendingHit?.chipId !== selectedChip.id && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => stepChip(selectedChip.id)}
                    >
                      1 Schritt
                    </button>
                  )}
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

function FactoryFee({
  current,
  onCommit,
}: {
  current: number
  onCommit: (fee: number) => void
}) {
  const [fee, setFee] = useState(current)
  return (
    <div className="stat-row">
      <span>Neue Gebühr</span>
      <div className="stepper">
        <button type="button" onClick={() => setFee((n) => Math.max(0, n - 1))}>
          −
        </button>
        <strong>{fee}</strong>
        <button type="button" onClick={() => setFee((n) => Math.min(10, n + 1))}>
          +
        </button>
      </div>
      <button type="button" className="btn compact" onClick={() => onCommit(fee)}>
        Setzen · 1 AP
      </button>
    </div>
  )
}

function hexEqualsShip(a: { q: number; r: number }, b: { q: number; r: number }) {
  return a.q === b.q && a.r === b.r
}

function isSourceTerrain(terrain: string): boolean {
  return terrain === 'uranium' || terrain === 'sun' || terrain === 'water'
}

function SourceAim({
  cell,
  phase,
  activePlayer,
  inRange,
  money,
  picking,
}: {
  cell: {
    sourceOwner?: PlayerId
    sourceDir?: number
  }
  phase: string
  activePlayer: PlayerId
  inRange: boolean
  money: number
  picking: boolean
}) {
  const ownedByActive = cell.sourceOwner === activePlayer
  const unclaimed = cell.sourceOwner == null
  const canAim = phase === 'act' && inRange && (ownedByActive || unclaimed)
  const aim =
    cell.sourceDir != null ? DIRECTIONS[cell.sourceDir - 1]?.label : null

  return (
    <div className="source-aim">
      <p className="hint">
        {cell.sourceOwner
          ? `Erschlossen · ${playerLabel(cell.sourceOwner)} · Pfeil ${cell.sourceDir ?? '—'} ${aim ?? ''}`
          : 'Unerschlossen — emittiert nicht'}
      </p>
      {phase === 'act' && unclaimed && !inRange && (
        <p className="hint">
          Schiff {playerLabel(activePlayer)} muss auf der Quelle oder daneben
          stehen, dann Quelle erschließen für 1 Geld.
        </p>
      )}
      {canAim && !picking && (
        <p className="hint">
          Quelle erschließen wählen — sechs Pfeile erscheinen an der Quelle.
        </p>
      )}
      {canAim && picking && (
        <p className="hint">Einen Pfeil an der Quelle anklicken · 1 Geld</p>
      )}
      {phase === 'act' && ownedByActive && !inRange && (
        <p className="hint">
          Zum Drehen muss das Schiff auf der Quelle oder daneben stehen.
        </p>
      )}
      {phase === 'act' && cell.sourceOwner && !ownedByActive && (
        <p className="hint">Gehört {playerLabel(cell.sourceOwner)}.</p>
      )}
      {phase !== 'act' && unclaimed && (
        <p className="hint">
          In der Aktionsphase für 1 Geld erschließen, solange das Schiff darauf
          oder daneben steht.
        </p>
      )}
      {canAim && money < 1 && <p className="hint">Nicht genug Geld (1).</p>}
    </div>
  )
}
