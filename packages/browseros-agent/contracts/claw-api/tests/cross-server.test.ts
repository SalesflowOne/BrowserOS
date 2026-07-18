import { afterAll, describe, test } from 'bun:test'
import { contractCases } from './cases'
import {
  type ContractServer,
  startRustServer,
  startTypeScriptServer,
} from './server-adapters'

for (const [name, start] of [
  ['typescript', startTypeScriptServer],
  ['rust', startRustServer],
] as const) {
  describe(`${name} canonical API`, () => {
    let server: ContractServer | undefined

    afterAll(async () => {
      await server?.stop()
    })

    for (const contractCase of contractCases) {
      test(contractCase.name, async () => {
        server ??= await start()
        try {
          await contractCase.run(server)
        } finally {
          if (contractCase.name === 'shutdown') {
            await server.stop()
            server = undefined
          }
        }
      })
    }
  })
}
