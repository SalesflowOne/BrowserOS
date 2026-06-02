// Production API port. Imported by:
// - src/main/index.ts — to bind Hono when running as a packaged app
// - src/mainview/modules/api/client.ts — fallback in the renderer when no
//   `?apiUrl=…` query is present (i.e., packaged builds loading via
//   file://). Dev runs use dynamic ports allocated at startup.
//
// Value matches the new distinctive port chosen in the parent commit so
// packaged builds don't collide with another Electron app on default
// ports.
export const PROD_API_PORT = 47574
