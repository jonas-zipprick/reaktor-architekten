import { simulateGame } from './simulate'
import type { WorkerRequest, WorkerResponse } from './types'

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  if (msg.type !== 'run') return

  try {
    const result = simulateGame({
      scenarioId: msg.scenarioId,
      seed: msg.seed,
      maxActions: msg.maxActions,
      heuristic: msg.heuristic,
    })
    const res: WorkerResponse = { type: 'result', jobId: msg.jobId, result }
    self.postMessage(res)
  } catch (e) {
    const res: WorkerResponse = {
      type: 'error',
      jobId: msg.jobId,
      seed: msg.seed,
      message: e instanceof Error ? e.message : String(e),
    }
    self.postMessage(res)
  }
}
