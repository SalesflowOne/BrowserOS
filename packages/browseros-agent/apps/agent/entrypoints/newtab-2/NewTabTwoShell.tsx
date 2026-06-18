import type { FC } from 'react'
import { useSearchParams } from 'react-router'
import { HoaDemo } from './hoa-demo/HoaDemo'
import type { ScenarioId } from './hoa-demo/types'

/**
 * `/newtab-2` is the recordable HOA sales demo. The scenario is driven by the
 * `?scenario=` query param so an operator can deep-link either workflow:
 *   /newtab-2                     → maintenance request (default)
 *   /newtab-2?scenario=estoppel   → estoppel + Form 1076
 */
export const NewTabTwoShell: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const scenarioId: ScenarioId =
    searchParams.get('scenario') === 'estoppel' ? 'estoppel' : 'maintenance'

  const handleScenarioChange = (id: ScenarioId) => {
    const next = new URLSearchParams(searchParams)
    next.set('scenario', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <HoaDemo scenarioId={scenarioId} onScenarioChange={handleScenarioChange} />
  )
}
