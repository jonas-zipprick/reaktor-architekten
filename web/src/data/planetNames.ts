/** Unique planet names — drawn when a planet tile is revealed. */
export const PLANET_NAMES = [
  'Kepler',
  'Nova',
  'Helios',
  'Vega',
  'Orion',
  'Lyra',
  'Atlas',
  'Ceres',
  'Io',
  'Titan',
  'Rhea',
  'Europa',
  'Callisto',
  'Phobos',
  'Deimos',
  'Solara',
  'Nyx',
  'Astra',
  'Quasar',
  'Pulsar',
] as const

/** Stable hue (0–360) per planet name — purely cosmetic. */
export function planetHue(name: string | undefined): number {
  if (!name) return 210
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export function shufflePlanetNames(
  rng: () => number = Math.random,
): string[] {
  const a = [...PLANET_NAMES]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
