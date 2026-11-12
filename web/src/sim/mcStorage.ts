import { RECORD_VERSION, type GameRecord } from '../state/recordFormat'
import type { SimRunMetrics, SimRunResult } from './types'

const DB_NAME = 'va-monte-carlo'
const DB_VERSION = 1
const STORE = 'runs'

export type StoredRun = SimRunMetrics & {
  winnerText: string | null
  record: GameRecord
  /** Run batch identity for filtering / clear. */
  batchKey: string
  savedAt: number
}

/** In-memory table row — no full record (lives in IndexedDB). */
export type SimRunSummary = SimRunMetrics & {
  winnerText: string | null
}

export function batchKeyOf(opts: {
  scenarioId: string
  heuristic: number
}): string {
  // Record-Version im Schlüssel: Läufe älterer Regelstände bleiben getrennt.
  return `r${RECORD_VERSION}|${opts.scenarioId}|${opts.heuristic.toFixed(2)}`
}

export function summaryOf(run: SimRunResult): SimRunSummary {
  const { record: _r, ...rest } = run
  return rest
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('batchKey', 'batchKey', { unique: false })
        store.createIndex('seed', 'seed', { unique: false })
      }
    }
  })
}

function runId(batchKey: string, seed: number): string {
  return `${batchKey}#${seed >>> 0}`
}

function toStoredRow(
  batchKey: string,
  result: SimRunResult,
): StoredRun & { id: string } {
  const { record, winnerText, ...metrics } = result
  return {
    id: runId(batchKey, result.seed),
    batchKey,
    ...metrics,
    winnerText,
    record,
    savedAt: Date.now(),
  }
}

export async function putRun(
  batchKey: string,
  result: SimRunResult,
): Promise<void> {
  await putRuns(batchKey, [result])
}

/** Mehrere Runs in einer IndexedDB-Transaktion schreiben. */
export async function putRuns(
  batchKey: string,
  results: SimRunResult[],
): Promise<void> {
  if (!results.length) return
  const db = await openDb()
  const rows = results.map((r) => toStoredRow(batchKey, r))
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('put failed'))
    const store = tx.objectStore(STORE)
    for (const row of rows) store.put(row)
  })
  db.close()
}

export async function getRun(
  batchKey: string,
  seed: number,
): Promise<StoredRun | null> {
  const db = await openDb()
  const row = await new Promise<StoredRun | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(runId(batchKey, seed))
    req.onsuccess = () => resolve((req.result as StoredRun) ?? null)
    req.onerror = () => reject(req.error ?? new Error('get failed'))
  })
  db.close()
  return row
}

export async function listSummaries(
  batchKey: string,
): Promise<SimRunSummary[]> {
  const db = await openDb()
  const rows = await new Promise<SimRunSummary[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('batchKey')
    const req = idx.getAll(batchKey)
    req.onsuccess = () => {
      const all = (req.result as StoredRun[]) ?? []
      resolve(
        all.map(({ record: _r, batchKey: _b, savedAt: _s, ...m }) => m),
      )
    }
    req.onerror = () => reject(req.error ?? new Error('list failed'))
  })
  db.close()
  return rows
}

export async function clearBatch(batchKey: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const idx = store.index('batchKey')
    const req = idx.openCursor(IDBKeyRange.only(batchKey))
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
  })
  db.close()
}
