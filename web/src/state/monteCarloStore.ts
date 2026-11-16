import { create } from 'zustand'
import {
  batchKeyOf,
  clearBatch,
  clearRuns,
  clearSummaries,
  getRun,
  listSummaries,
  putRuns,
  summaryOf,
  type SimRunSummary,
} from '../sim/mcStorage'
import { runSimulationPool, type PoolHandle } from '../sim/pool'
import type {
  SimConfig,
  SimOutcome,
  SimProgress,
  SimRunResult,
} from '../sim/types'
import type { ScenarioId } from '../types'
import { serializeRecord } from './recordFormat'

export type SortKey = keyof SimRunSummary

/** Aktive Ergebniskategorien. */
export const ALL_OUTCOMES: SimOutcome[] = [
  'finished',
  'aborted',
  'stuck',
]

export interface MonteCarloFilters {
  /** Included outcomes; empty = none shown. Default: all. */
  outcomes: SimOutcome[]
  /** Mindestzahl fertiger Ernte-Folgen 7→2. */
  minHarvestDone: number | null
  querySeed: string
}

interface MonteCarloStore {
  config: SimConfig
  progress: SimProgress
  /** Metrics only — full records live in IndexedDB. */
  results: SimRunSummary[]
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  filters: MonteCarloFilters
  error: string | null
  persistError: string | null
  setConfig: (partial: Partial<SimConfig>) => void
  setSort: (key: SortKey) => void
  setFilters: (partial: Partial<MonteCarloFilters>) => void
  /** Fresh run from startSeed (clears this batch in IDB). */
  start: () => void
  /** Continue after pause from progress.nextSeed. */
  resume: () => void
  pause: () => void
  clearResults: () => void
  /** Load summaries for current config from IndexedDB (e.g. page open). */
  hydrateFromDisk: () => Promise<void>
  /** Full record JSON for timeline import; null if missing. */
  loadRecordJson: (seed: number) => Promise<string | null>
}

let handle: PoolHandle | null = null
/** Invalidates in-flight hydrate / delayed start when a newer start wins. */
let runEpoch = 0
/** Full-record clears still in flight; putRuns must wait so new writes aren't deleted. */
const runsClearPending = new Map<string, Promise<void>>()
/** Buffer writes so IDB isn't hit once per microtask under high throughput. */
let persistQueue: SimRunResult[] = []
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persisting = false
/** Resolvers waiting until the persist backlog drains below the low watermark. */
let persistWaiters: Array<() => void> = []

function waitForRunsClear(batchKey: string): Promise<void> {
  return runsClearPending.get(batchKey) ?? Promise.resolve()
}

function startRunsClear(batchKey: string): Promise<void> {
  const prev = runsClearPending.get(batchKey) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(() => clearRuns(batchKey))
    .finally(() => {
      if (runsClearPending.get(batchKey) === next) {
        runsClearPending.delete(batchKey)
      }
    })
  runsClearPending.set(batchKey, next)
  return next
}

/** Pause new sims when this many full records sit unsynced. */
const PERSIST_HIGH = 48
/** Resume once the queue is at or below this. */
const PERSIST_LOW = 16
/** Max rows per IndexedDB transaction. */
const PERSIST_TX_CHUNK = 24

/** Aktionslimit je Lauf (Kartenbewegungen, Gebühren, Auktionen, Zugenden). */
const MAX_ACTIONS_DEFAULT = 5000

const defaultConfig = (): SimConfig => ({
  scenarioId: 'B',
  startSeed: 1,
  maxActions: MAX_ACTIONS_DEFAULT,
  workers: 0,
  heuristic: 0.5,
})

function currentBatchKey(config: SimConfig): string {
  return batchKeyOf(config)
}

function wakePersistWaiters(force = false): void {
  if (!force && persistQueue.length > PERSIST_LOW) return
  const waiters = persistWaiters
  persistWaiters = []
  for (const wake of waiters) wake()
}

function waitForPersistDrain(): Promise<void> {
  if (persistQueue.length <= PERSIST_LOW) return Promise.resolve()
  return new Promise((resolve) => {
    persistWaiters.push(resolve)
  })
}

async function flushPersist(batchKey: string): Promise<void> {
  if (persisting) return
  persisting = true
  try {
    await waitForRunsClear(batchKey)
    while (persistQueue.length) {
      const batch = persistQueue.splice(0, PERSIST_TX_CHUNK)
      await putRuns(batchKey, batch)
      wakePersistWaiters()
    }
  } finally {
    persisting = false
    wakePersistWaiters()
    if (persistQueue.length) await flushPersist(batchKey)
  }
}

function schedulePersistFlush(
  batchKey: string,
  onError: (msg: string) => void,
  immediate = false,
): void {
  const run = () => {
    persistTimer = null
    void flushPersist(batchKey).catch((e) => {
      onError(e instanceof Error ? e.message : String(e))
      // Avoid deadlocking workers if IDB fails.
      wakePersistWaiters(true)
    })
  }
  if (immediate) {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    run()
    return
  }
  if (persistTimer) return
  persistTimer = setTimeout(run, 80)
}

/**
 * Queue a run for IndexedDB. If the backlog is high, resolves only after
 * enough writes have drained (backpressure for the worker pool).
 */
function enqueuePersist(
  batchKey: string,
  result: SimRunResult,
  onError: (msg: string) => void,
): Promise<void> {
  persistQueue.push(result)
  const backlog = persistQueue.length
  schedulePersistFlush(batchKey, onError, backlog >= PERSIST_HIGH / 2)
  if (backlog < PERSIST_HIGH) return Promise.resolve()
  return waitForPersistDrain()
}

function launchPool(
  get: () => MonteCarloStore,
  set: (
    partial:
      | Partial<MonteCarloStore>
      | ((s: MonteCarloStore) => Partial<MonteCarloStore>),
  ) => void,
  fromSeed: number,
  append: boolean,
): void {
  handle?.pause()
  handle = null

  const config = { ...get().config, startSeed: fromSeed }
  const batchKey = currentBatchKey(config)

  if (!append) {
    set({
      results: [],
      error: null,
      persistError: null,
      progress: {
        done: 0,
        nextSeed: fromSeed >>> 0,
        running: true,
        paused: false,
      },
    })
  } else {
    set({
      error: null,
      progress: {
        ...get().progress,
        nextSeed: fromSeed >>> 0,
        running: true,
        paused: false,
      },
    })
  }

  const baseDone = append ? get().progress.done : 0

  handle = runSimulationPool(
    config,
    async (result, progress) => {
      const summary = summaryOf(result)
      set((s) => {
        // Seed-unique: verhindert Doppel-Keys wenn Hydrate und Pool sich überholen.
        const i = s.results.findIndex((r) => r.seed === summary.seed)
        const results =
          i < 0
            ? [...s.results, summary]
            : s.results.map((r, idx) => (idx === i ? summary : r))
        return {
          results,
          progress: {
            done: baseDone + progress.done,
            nextSeed: progress.nextSeed,
            running: true,
            paused: false,
          },
        }
      })
      // Backpressure: wait if IDB writes lag behind (avoids OOM).
      await enqueuePersist(batchKey, result, (msg) =>
        set({ persistError: msg }),
      )
    },
    (progress) => {
      handle = null
      // Flush remaining buffer on pause
      void flushPersist(batchKey).catch((e) =>
        set({
          persistError: e instanceof Error ? e.message : String(e),
        }),
      )
      set({
        progress: {
          done: baseDone + progress.done,
          nextSeed: progress.nextSeed,
          running: false,
          paused: true,
        },
      })
    },
    (message) => set({ error: message }),
  )
}

export const useMonteCarloStore = create<MonteCarloStore>((set, get) => ({
  config: defaultConfig(),
  progress: { done: 0, nextSeed: 1, running: false, paused: false },
  results: [],
  sortKey: 'harvestDone',
  sortDir: 'desc',
  filters: {
    outcomes: [...ALL_OUTCOMES],
    minHarvestDone: null,
    querySeed: '',
  },
  error: null,
  persistError: null,

  setConfig: (partial) =>
    set({ config: { ...get().config, ...partial } }),

  setSort: (key) => {
    const { sortKey, sortDir } = get()
    if (sortKey === key) {
      set({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ sortKey: key, sortDir: 'desc' })
    }
  },

  setFilters: (partial) =>
    set({ filters: { ...get().filters, ...partial } }),

  start: () => {
    if (get().progress.running) return
    handle?.pause()
    handle = null
    persistQueue = []
    wakePersistWaiters(true)

    const { config } = get()
    const fromSeed = config.startSeed
    const batchKey = currentBatchKey(config)
    const epoch = ++runEpoch

    // Sofort UI-Feedback — nicht auf IndexedDB-Löschen warten.
    set({
      results: [],
      error: null,
      persistError: null,
      progress: {
        done: 0,
        nextSeed: fromSeed >>> 0,
        running: true,
        paused: false,
      },
    })

    void (async () => {
      try {
        // Summaries sind klein → schnell; Vollrecords parallel im Hintergrund.
        await clearSummaries(batchKey)
        void startRunsClear(batchKey).catch((e) => {
          if (epoch !== runEpoch) return
          set({
            persistError: e instanceof Error ? e.message : String(e),
          })
        })
      } catch (e) {
        if (epoch !== runEpoch) return
        set({
          persistError: e instanceof Error ? e.message : String(e),
        })
      }
      if (epoch !== runEpoch) return
      // append=false setzt results erneut leer; Pool startet sofort.
      launchPool(get, set, fromSeed, false)
    })()
  },

  resume: () => {
    if (get().progress.running) return
    const { progress } = get()
    if (!progress.paused && progress.done === 0) {
      get().start()
      return
    }
    runEpoch += 1
    launchPool(get, set, progress.nextSeed, true)
  },

  pause: () => {
    handle?.pause()
  },

  clearResults: () => {
    runEpoch += 1
    handle?.pause()
    handle = null
    persistQueue = []
    wakePersistWaiters(true)
    const batchKey = currentBatchKey(get().config)
    void clearBatch(batchKey).catch((e) =>
      set({
        persistError: e instanceof Error ? e.message : String(e),
      }),
    )
    set({
      results: [],
      progress: {
        done: 0,
        nextSeed: get().config.startSeed >>> 0,
        running: false,
        paused: false,
      },
      error: null,
    })
  },

  hydrateFromDisk: async () => {
    if (get().progress.running) return
    const epoch = runEpoch
    const batchKey = currentBatchKey(get().config)
    try {
      const rows = await listSummaries(batchKey)
      // Start/Resume zwischenzeitlich → Hydrate nicht über Pool-Ergebnisse schreiben.
      if (epoch !== runEpoch || get().progress.running) return
      const bySeed = new Map<number, SimRunSummary>()
      for (const r of rows) bySeed.set(r.seed, r)
      const unique = [...bySeed.values()]
      const maxSeed = unique.reduce((m, r) => Math.max(m, r.seed), -1)
      set({
        results: unique,
        progress: {
          done: unique.length,
          nextSeed:
            maxSeed >= 0
              ? (maxSeed + 1) >>> 0
              : get().config.startSeed >>> 0,
          running: false,
          paused: unique.length > 0,
        },
        persistError: null,
      })
    } catch (e) {
      if (epoch !== runEpoch || get().progress.running) return
      set({
        persistError: e instanceof Error ? e.message : String(e),
      })
    }
  },

  loadRecordJson: async (seed) => {
    const batchKey = currentBatchKey(get().config)
    const row = await getRun(batchKey, seed)
    if (!row?.record) return null
    return serializeRecord(row.record)
  },
}))

export function filterSortResults(state: {
  results: SimRunSummary[]
  filters: MonteCarloFilters
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
}): SimRunSummary[] {
  let rows = state.results
  const { filters, sortKey, sortDir } = state

  if (filters.outcomes.length < ALL_OUTCOMES.length) {
    const allowed = new Set(filters.outcomes)
    rows = rows.filter((r) => allowed.has(r.outcome))
  }
  if (filters.minHarvestDone != null) {
    rows = rows.filter((r) => r.harvestDone >= filters.minHarvestDone!)
  }
  if (filters.querySeed.trim()) {
    const q = filters.querySeed.trim()
    rows = rows.filter((r) => String(r.seed).includes(q))
  }

  const dir = sortDir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'boolean' && typeof bv === 'boolean') {
      return (Number(av) - Number(bv)) * dir
    }
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv) * dir
    }
    return ((av as number) - (bv as number)) * dir
  })
}

export function parseScenarioId(v: string): ScenarioId {
  if (v === 'A' || v === 'B' || v === 'C' || v === 'D') return v
  return 'B'
}
