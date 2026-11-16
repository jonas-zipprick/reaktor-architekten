import { useState } from 'react'
import type { GameState } from '../types'
import { useGameStore } from '../state/gameStore'
import './AuctionDialog.css'

/**
 * Offene Auktion am Tisch: Startgebot 1¤, jedes Gebot mindestens 1¤ höher,
 * geboten wird nur mit Bargeld. Der Zuschlag beendet die Auktion.
 */
export function AuctionDialog({ game }: { game: GameState }) {
  const auction = useGameStore((s) => s.auction)
  const placeBid = useGameStore((s) => s.placeBid)
  const closeAuction = useGameStore((s) => s.closeAuction)
  const [amounts, setAmounts] = useState<Record<string, number>>({})

  if (!auction) return null
  const field = game.fields[auction.fieldId]
  if (!field) return null

  const opener = game.players[game.currentPlayerIndex]!
  const minBid = auction.highBid + 1
  const leader = game.players.find((p) => p.id === auction.highBidder)
  const isState = auction.seller === 'state'

  return (
    <div className="auction-backdrop">
      <div
        className="auction-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Auktion ${field.label}`}
      >
        <p className="auction-kicker">
          {isState ? 'Privatisierung' : `Verkauf durch ${opener.name}`}
        </p>
        <h2>{field.label}</h2>
        <p className="auction-note">
          {`Offene Auktion · Startgebot 1¤ · jedes Gebot mindestens 1¤ höher · nur Bargeld. Erlös geht ${
            isState ? 'an die Bank' : `an ${opener.name}`
          }.`}
        </p>

        <p className="auction-high">
          {leader ? (
            <>
              Höchstgebot <strong>{auction.highBid}¤</strong> von{' '}
              <strong>{leader.name}</strong>
            </>
          ) : (
            'Noch kein Gebot'
          )}
        </p>

        <ul className="auction-bidders">
          {auction.bidders.map((id) => {
            const p = game.players.find((x) => x.id === id)
            if (!p) return null
            const leading = auction.highBidder === id
            const canBid = !leading && p.money >= minBid
            const amount = Math.min(
              p.money,
              Math.max(minBid, amounts[id] ?? minBid),
            )
            return (
              <li key={id} className={leading ? 'leading' : ''}>
                <span className="auction-name">
                  <i style={{ background: p.color }} />
                  {p.name}
                  <em>{p.money}¤</em>
                </span>
                {leading ? (
                  <span className="auction-status">führt</span>
                ) : canBid ? (
                  <>
                    <input
                      type="number"
                      aria-label={`Gebot ${p.name}`}
                      min={minBid}
                      max={p.money}
                      value={amount}
                      onChange={(e) =>
                        setAmounts({
                          ...amounts,
                          [id]: Math.floor(Number(e.target.value)) || minBid,
                        })
                      }
                    />
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => placeBid(id, amount)}
                    >
                      Bieten
                    </button>
                  </>
                ) : (
                  <span className="auction-status">zu wenig Bargeld</span>
                )}
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          className="primary-btn"
          onClick={() => closeAuction()}
        >
          {leader
            ? `Zuschlag: ${leader.name} für ${auction.highBid}¤`
            : 'Ohne Gebot beenden'}
          <span className="btn-sub">
            {leader
              ? 'niemand erhöht mehr'
              : `${isState ? 'der Staat' : opener.name} behält den Betrieb`}
          </span>
        </button>
      </div>
    </div>
  )
}
