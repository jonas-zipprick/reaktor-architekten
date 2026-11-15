import { useEffect, useRef, useState } from 'react'
import { actionLabel, useGameStore } from '../state/gameStore'
import './Timeline.css'

const COLLAPSE_KEY = 'ernte-timeline-collapsed'

export function Timeline() {
  const record = useGameStore((s) => s.record)
  const viewIndex = useGameStore((s) => s.viewIndex)
  const isHistoric = useGameStore((s) => s.isHistoric)
  const seek = useGameStore((s) => s.seek)
  const undo = useGameStore((s) => s.undo)
  const moveAnim = useGameStore((s) => s.moveAnim)
  const exportRecord = useGameStore((s) => s.exportRecord)
  const importRecord = useGameStore((s) => s.importRecord)
  const fileRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  // Lange Partien: die Spur scrollt, der aktive Knoten bleibt sichtbar.
  useEffect(() => {
    if (collapsed) return
    trackRef.current
      ?.querySelector('.timeline-node.active')
      ?.scrollIntoView({ block: 'nearest' })
  }, [viewIndex, collapsed])

  // Pfeiltasten: Historie vor/zurück (ohne Timeline-Buttons klicken zu müssen).
  useEffect(() => {
    if (!record) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (useGameStore.getState().moveAnim || useGameStore.getState().auction) {
        return
      }
      e.preventDefault()
      const { viewIndex: idx, record: rec, seek: go } = useGameStore.getState()
      if (!rec) return
      if (e.key === 'ArrowLeft') {
        if (idx > 0) go(idx - 1)
      } else if (idx < rec.actions.length) {
        go(idx + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [record])

  if (!record) return null

  const total = record.actions.length
  const busy = Boolean(moveAnim)
  const onExport = () => {
    const raw = exportRecord()
    if (!raw) return
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `va-${record.setup.scenarioId}-${record.setup.seed}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportFile = async (file: File) => {
    const text = await file.text()
    try {
      importRecord(text)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Import fehlgeschlagen')
    }
  }

  return (
    <footer
      className={`timeline ${isHistoric ? 'historic' : ''} ${collapsed ? 'collapsed' : ''}`}
    >
      <button
        type="button"
        className="ghost-btn timeline-collapse-btn"
        aria-expanded={!collapsed}
        aria-controls="timeline-body"
        title={collapsed ? 'Zeitstrahl ausklappen' : 'Zeitstrahl einklappen'}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? '▴' : '▾'}
        <span className="timeline-collapse-label">
          {collapsed ? 'Zeitstrahl' : 'Einklappen'}
        </span>
        {collapsed && (
          <span className="timeline-collapse-pos">
            {viewIndex}/{total}
            {isHistoric ? ' · Historie' : ''}
          </span>
        )}
      </button>

      <div
        id="timeline-body"
        className="timeline-body"
        hidden={collapsed}
        inert={collapsed || undefined}
      >
        <div className="timeline-meta">
          <span className="timeline-title">Zeitstrahl</span>
          <span className="timeline-pos">
            {viewIndex}/{total}
            {isHistoric ? ' · Historie' : ''}
          </span>
          <span className="timeline-seed" title="RNG-Seed">
            seed {record.setup.seed}
          </span>
        </div>

        <div className="timeline-track" role="list" ref={trackRef}>
          <button
            type="button"
            className={`timeline-node start ${viewIndex === 0 ? 'active' : ''}`}
            title="Partiebeginn"
            disabled={busy}
            onClick={() => seek(0)}
          >
            0
          </button>
          {record.actions.map((action, i) => {
            const idx = i + 1
            return (
              <button
                type="button"
                key={i}
                role="listitem"
                className={[
                  'timeline-node',
                  action.type,
                  viewIndex === idx ? 'active' : '',
                  idx < viewIndex ? 'past' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={actionLabel(action, record.setup.scenarioId)}
                disabled={busy}
                onClick={() => seek(idx)}
              >
                {idx}
              </button>
            )
          })}
        </div>

        <div className="timeline-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy || viewIndex <= 0}
            onClick={undo}
            title="Einen Schritt zurück (←)"
          >
            ← Zurück
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy || viewIndex >= total}
            onClick={() => seek(viewIndex + 1)}
            title="Einen Schritt vor (→)"
          >
            Vor →
          </button>
          {isHistoric && (
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => seek(total)}
            >
              Zur Live-Position
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={onExport}>
            Export JSON
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => fileRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>
    </footer>
  )
}
