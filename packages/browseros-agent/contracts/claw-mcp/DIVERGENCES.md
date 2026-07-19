# Cross-server divergences

The claw-mcp contract suite compares `apps/claw-server` (TypeScript) and
`apps/claw-server-rust` **semantically** and fails the parity gate on any
difference **not** listed here. Each entry has an `id` that a case passes
to `ctx.record(key, value, { divergence: id })` to exempt that signature
from equality. The machine-checked twin of this table is
[`tests/divergences.ts`](./tests/divergences.ts) — keep the two in lockstep.

Everything here was **verified live** against a real BrowserOS while
building the suite. Some are intended (a param only Rust implements);
several are **bugs the suite caught** — those are the migration gold and
are called out below.

## Intended (Rust implements a capability the TS server does not)

| id | behavior | Rust | TypeScript |
|----|----------|------|------------|
| `snapshot-mode-param` | `snapshot` `mode` (full\|interactive) | supported; interactive prunes non-interactive branches | not in the input schema; full only |
| `snapshot-depth-param` | `snapshot` `depth` (1..=100) | supported; truncates the rendered tree | not in the input schema |
| `act-dialog-kinds` | `act` kinds `dialog_accept` / `dialog_dismiss` | supported; resolves the pending JS dialog | not in the kind enum; call rejected |
| `read-console-format` | `read` `format=console` | supported; returns captured console entries | format enum is markdown\|text\|links only |

## Behavioral (same intent, different surface)

| id | behavior | Rust | TypeScript |
|----|----------|------|------------|
| `tabs-new-snapshot` | auto-context on `tabs action=new` | embeds a fresh `[Page N snapshot]` | returns only `opened page N` |
| `act-console-summary` | console summary in `act` auto-context | appends `[page N console] …` on logged errors/warnings | embeds the settled diff only |
| `ownership-error-wording` | ownership-guard text for a foreign page | `page N is not owned by this agent; …` | names the owner: `page N is owned by <title>; …` |
| `covered-click-blocker-naming` | error text when a click hits an occluded element | names the intercepting element | does not name the blocker (click still blocked) |
| `delete-hygiene-content-type` | `DELETE /mcp` teardown with no content-type | accepted (bodyless DELETE is exempt) | rejected 415; teardown must send `content-type: application/json` |

## Bugs the suite caught (migration gold — surface these prominently)

These are **not** intended differences. They are latent bugs one server
has and the other does not, found only because a real browser was in the
loop. They are registered as divergences so the suite stays green today,
but each is a fix waiting to happen.

| id | behavior | Rust | TypeScript |
|----|----------|------|------------|
| `act-check-kind` | `act` kinds `check` / `uncheck` | **broken**: `CDP error: Invalid parameters` | works; sets the checkbox and reports `ok (check)` |
| `act-scroll` | `act kind=scroll` (page wheel scroll) | **broken**: `Input.dispatchMouseEvent` times out (~60s) | works; scrolls ~`amount*120px` |
| `windows-set-visibility` | `windows action=set_visibility` | **broken**: `CDP error: Invalid parameters` for hide and show | hides but **recreates** the window (`set window X hidden; new window id Y`); old id dies |

## Shared limitations (both servers, parity holds — worth fixing in both)

Not divergences (the servers agree), but real gaps the suite documents so
a one-sided fix would trip the parity gate:

- **`act kind=focus` by ref is broken on both** — fails with `CDP error:
  Document needs to be requested first` (`focusElement` pushes backend
  node ids to the frontend without a prior `DOM.getDocument`, which a
  snapshot never primes). A real `click` is the working focus path.
- **A checked checkbox never renders `[checked]`** from a live CDP AX
  tree on either server (the state is not surfaced in the accessibility
  name/properties the snapshot reads).
- **`evaluate` does not enforce its `timeout`** on a page-context wait
  (the JS runs in the renderer; CDP cannot preempt it), so a delay longer
  than the timeout still runs to completion on both servers.
- **A browser that dies mid-session** surfaces `CDP not connected` on
  every tool, **not** the polished `start BrowserClaw` guard (that guard
  only fires when the browser is unreachable at boot). Both servers behave
  identically.

## How to change this table

1. Add or edit the entry in [`tests/divergences.ts`](./tests/divergences.ts)
   (the code is the source of truth; unknown ids fail the parity gate).
2. Mirror it here so the human-readable ledger stays honest.
3. If you are **removing** a divergence because a server was fixed, delete
   the `{ divergence: id }` tag from the case so the parity gate starts
   enforcing equality for that signature again.
