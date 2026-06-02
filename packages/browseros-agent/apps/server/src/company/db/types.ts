import type { drizzle } from 'drizzle-orm/libsql'
import type * as schema from './schema/schema.js'

// Pulled out of db/index.ts so the renderer's type graph can reach this
// without dragging in node:fs / node:os from the runtime boot code.
export type DB = ReturnType<typeof drizzle<typeof schema>>
