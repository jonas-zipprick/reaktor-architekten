import { RECORD_VERSION, type GameRecord } from '../state/recordFormat'
import type { SimRunMetrics, SimRunResult } from './types'

const DB_NAME = 'va-monte-carlo'
/** v2: summaries getrennt von Vollrecords — getAll auf runs hat den Tab (SIGILL/OOM) gekillt. */
const DB_VERSION = 2
const STORE_RUNS = 'runs'
const STORE_SUMMARIES = 'summaries'

export type StoredRun = SimRunMetrics & {
  winnerText: string | null
  record: GameRecord
  /** Run batch identity for filtering / clear. */
  batchKey: string
  savedAt: number
}

/** In-memory / IDB table row — no full record. */
export type SimRunSummary = SimRunMetrics & {
  winnerText: string | null
}

type StoredSummary = SimRunSummary & {
  id: string
  batchKey: string
  savedAt: number
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
    req.onupgradeneeded = (ev) => {
      const db = req.result
      const tx = req.transaction
      if (!tx) return

      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        const store = db.createObjectStore(STORE_RUNS, { keyPath: 'id' })
        store.createIndex('batchKey', 'batchKey', { unique: false })
        store.createIndex('seed', 'seed', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORE_SUMMARIES)) {
        const store = db.createObjectStore(STORE_SUMMARIES, { keyPath: 'id' })
        store.createIndex('batchKey', 'batchKey', { unique: false })
      }

      // v1→v2: alte Vollrecords ohne Deserialisierung verwerfen (sonst Tab-Crash).
      if (ev.oldVersion < 2 && db.objectStoreNames.contains(STORE_RUNS)) {
        tx.objectStore(STORE_RUNS).clear()
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

function toStoredSummary(
  batchKey: string,
  result: SimRunResult,
): StoredSummary {
  const { record: _r, ...rest } = result
  return {
    id: runId(batchKey, result.seed),
    batchKey,
    ...rest,
    fieldsBought: rest.fieldsBought ?? 0,
    savedAt: Date.now(),
  }
}

export async function putRun(
  batchKey: string,
  result: SimRunResult,
): Promise<void> {
  await putRuns(batchKey, [result])
}

/** Mehrere Runs: Kennzahlen + Vollrecord in getrennten Stores. */
export async function putRuns(
  batchKey: string,
  results: SimRunResult[],
): Promise<void> {
  if (!results.length) return
  const db = await openDb()
  const full = results.map((r) => toStoredRow(batchKey, r))
  const sums = results.map((r) => toStoredSummary(batchKey, r))
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_RUNS, STORE_SUMMARIES], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('put failed'))
    const runs = tx.objectStore(STORE_RUNS)
    const summaries = tx.objectStore(STORE_SUMMARIES)
    for (const row of full) runs.put(row)
    for (const row of sums) summaries.put(row)
  })
  db.close()
}

export async function getRun(
  batchKey: string,
  seed: number,
): Promise<StoredRun | null> {
  const db = await openDb()
  const row = await new Promise<StoredRun | null>((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, 'readonly')
    const req = tx.objectStore(STORE_RUNS).get(runId(batchKey, seed))
    req.onsuccess = () => resolve((req.result as StoredRun) ?? null)
    req.onerror = () => reject(req.error ?? new Error('get failed'))
  })
  db.close()
  return row
}

/** Nur Kennzahlen — kein Deserialisieren der Vollrecords. */
export async function listSummaries(
  batchKey: string,
): Promise<SimRunSummary[]> {
  const db = await openDb()
  const rows = await new Promise<SimRunSummary[]>((resolve, reject) => {
    const tx = db.transaction(STORE_SUMMARIES, 'readonly')
    const idx = tx.objectStore(STORE_SUMMARIES).index('batchKey')
    const req = idx.getAll(batchKey)
    req.onsuccess = () => {
      const all = (req.result as StoredSummary[]) ?? []
      resolve(
        all.map(({ id: _i, batchKey: _b, savedAt: _s, ...m }) => ({
          ...m,
          fieldsBought: m.fieldsBought ?? 0,
        })),
      )
    }
    req.onerror = () => reject(req.error ?? new Error('list failed'))
  })
  db.close()
  return rows
}

/** Keys löschen ohne Record-Bodies zu laden. */
async function deleteByBatchKey(
  db: IDBDatabase,
  storeName: string,
  batchKey: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.index('batchKey').getAllKeys(IDBKeyRange.only(batchKey))
    req.onsuccess = () => {
      for (const key of req.result) store.delete(key)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
  })
}

/** Schnell: nur Kennzahlen-Zeilen (kleine Objekte). */
export async function clearSummaries(batchKey: string): Promise<void> {
  const db = await openDb()
  try {
    await deleteByBatchKey(db, STORE_SUMMARIES, batchKey)
  } finally {
    db.close()
  }
}

/** Langsam bei vielen Vollrecords — im Hintergrund nach Start aufrufen. */
export async function clearRuns(batchKey: string): Promise<void> {
  const db = await openDb()
  try {
    await deleteByBatchKey(db, STORE_RUNS, batchKey)
  } finally {
    db.close()
  }
}

export async function clearBatch(batchKey: string): Promise<void> {
  await clearSummaries(batchKey)
  await clearRuns(batchKey)
}
