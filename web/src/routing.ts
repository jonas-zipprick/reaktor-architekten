import type { ScenarioId } from './types'

export type AppRoute =
  | { page: 'menu' }
  | { page: 'play'; scenarioId: ScenarioId; seed?: number }
  | { page: 'montecarlo' }

const SCENARIO_IDS: ScenarioId[] = ['A', 'B', 'C', 'D']

function isScenarioId(v: string): v is ScenarioId {
  return (SCENARIO_IDS as string[]).includes(v)
}

/** Pfad + Query aus der aktuellen Location lesen. */
export function parseLocation(
  pathname = window.location.pathname,
  search = window.location.search,
): AppRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)

  if (path === '/' || path === '/menu') return { page: 'menu' }

  if (path === '/montecarlo' || path === '/mc') return { page: 'montecarlo' }

  const play = /^\/play\/([A-Da-d])$/.exec(path)
  if (play) {
    const id = play[1]!.toUpperCase()
    if (!isScenarioId(id)) return { page: 'menu' }
    const seedRaw = params.get('seed')
    const seed =
      seedRaw != null && seedRaw !== '' && Number.isFinite(Number(seedRaw))
        ? Number(seedRaw) >>> 0
        : undefined
    return { page: 'play', scenarioId: id, seed }
  }

  return { page: 'menu' }
}

/** URL-String für eine Route (pathname + search). */
export function routeToHref(route: AppRoute): string {
  switch (route.page) {
    case 'menu':
      return '/'
    case 'montecarlo':
      return '/montecarlo'
    case 'play': {
      const base = `/play/${route.scenarioId}`
      return route.seed != null ? `${base}?seed=${route.seed}` : base
    }
  }
}

/** Browser-URL anpassen (push oder replace). */
export function syncUrl(route: AppRoute, mode: 'push' | 'replace' = 'push'): void {
  const href = routeToHref(route)
  const current = `${window.location.pathname}${window.location.search}`
  if (current === href || (href === '/' && current === '')) return
  if (mode === 'replace') {
    window.history.replaceState(route, '', href)
  } else {
    window.history.pushState(route, '', href)
  }
}
