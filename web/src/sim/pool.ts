import type {
  SimConfig,
  SimProgress,
  SimRunResult,
  WorkerRequest,
  WorkerResponse,
} from './types'

export interface PoolHandle {
  /** Stop scheduling new seeds; finish in-flight, then invoke onPaused. */
  pause: () => void
}

/**
 * Run simulations continuously from `config.startSeed` upward until paused.
 * Seeds wrap as uint32.
 */
export function runSimulationPool(
  config: SimConfig,
  onResult: (
    result: SimRunResult,
    progress: SimProgress,
  ) => void | Promise<void>,
  onPaused: (progress: SimProgress) => void,
  onError?: (message: string) => void,
): PoolHandle {
  let nextSeed = config.startSeed >>> 0
  let done = 0
  let paused = false
  let inFlight = 0
  let finished = false

  const workerCount = Math.max(
    1,
    config.workers > 0
      ? config.workers
      : typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency || 4
        : 4,
  )

  const workers: Worker[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      new Worker(new URL('./simWorker.ts', import.meta.url), {
        type: 'module',
      }),
    )
  }

  const snap = (running: boolean): SimProgress => ({
    done,
    nextSeed,
    running,
    paused: paused && !running,
  })

  const maybeFinishPause = () => {
    if (!paused || inFlight > 0 || finished) return
    finished = true
    for (const w of workers) w.terminate()
    onPaused(snap(false))
  }

  const assign = (worker: Worker) => {
    if (paused || finished) return
    const seed = nextSeed
    nextSeed = (nextSeed + 1) >>> 0
    const jobId = done + inFlight
    inFlight += 1
    const req: WorkerRequest = {
      type: 'run',
      jobId,
      scenarioId: config.scenarioId,
      seed,
      maxActions: config.maxActions,
      heuristic: config.heuristic,
    }
    worker.postMessage(req)
  }

  const afterJob = async (
    worker: Worker,
    work: () => void | Promise<void>,
  ) => {
    if (finished) return
    try {
      await work()
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e))
    }
    if (paused) maybeFinishPause()
    else assign(worker)
  }

  for (const worker of workers) {
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data
      inFlight = Math.max(0, inFlight - 1)

      void afterJob(worker, async () => {
        if (finished) return
        if (msg.type === 'result') {
          done += 1
          await onResult(msg.result, snap(!paused))
        } else if (msg.type === 'error') {
          onError?.(msg.message)
        }
      })
    }
    worker.onerror = (err) => {
      inFlight = Math.max(0, inFlight - 1)
      void afterJob(worker, () => {
        onError?.(err.message || 'Worker-Fehler')
      })
    }
    assign(worker)
  }

  return {
    pause: () => {
      if (paused || finished) return
      paused = true
      maybeFinishPause()
    },
  }
}
