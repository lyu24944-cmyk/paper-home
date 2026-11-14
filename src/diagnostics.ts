export const qaEnabled = new URLSearchParams(location.search).has('qa')
export type PerformanceEvent = { at: number; name: string; durationMs?: number; detail?: string }
export const performanceEvents: PerformanceEvent[] = []
export function recordEvent(name: string, durationMs?: number, detail?: string) {
  if (qaEnabled) performanceEvents.push({ at: performance.now(), name, durationMs, detail })
}
