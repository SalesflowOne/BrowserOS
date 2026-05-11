import type { HarnessAdapterDescriptor } from './agent-harness-types'

export interface AdapterReadinessAlert {
  title: string
  description: string
}

export function getAdapterReadinessAlert(
  adapter: HarnessAdapterDescriptor | undefined,
): AdapterReadinessAlert | null {
  if (!adapter || adapter.health?.healthy !== false) return null
  return {
    title: `${adapter.name} runtime is not ready`,
    description:
      adapter.health.reason ??
      'BrowserOS is still preparing this runtime. Choose another adapter or retry after it is ready.',
  }
}
