#!/usr/bin/env bash
# Example end-to-end drive of the web harness using the `agent-browser` CLI.
#
# Prereqs (see web/README.md):
#   1. The real stack is running:  bun run dev:watch        (BrowserOS + server)
#   2. The web harness is served:  cd apps/agent && bun run web   (http://localhost:5300)
#   3. `agent-browser` is installed and its BrowserOS provider is reachable.
#   4. At least one LLM provider/agent is configured (for a real reply).
#
# This is a starting point, not a strict assertion suite — adjust refs/selectors
# to the current UI. `snapshot -i` prints @e refs; plug the right ones below.
set -euo pipefail

URL="${WEB_HARNESS_URL:-http://localhost:5300/#/home}"
PROMPT="${1:-What is the title of example.com?}"
P=(-p browseros) # use the BrowserOS provider

echo "→ opening web harness: $URL"
agent-browser "${P[@]}" tab new "$URL"
agent-browser "${P[@]}" wait --load networkidle

echo "→ snapshot (find the chat input + send button refs):"
agent-browser "${P[@]}" snapshot -i

# Replace @eINPUT / @eSEND with the refs printed above.
: "${INPUT_REF:=@eINPUT}"
: "${SEND_REF:=@eSEND}"

echo "→ typing prompt into $INPUT_REF and sending via $SEND_REF"
agent-browser "${P[@]}" fill "$INPUT_REF" "$PROMPT"
agent-browser "${P[@]}" click "$SEND_REF"

echo "→ waiting for the streamed reply to render"
agent-browser "${P[@]}" wait --timeout 60000

echo "→ captured page text (assert on this):"
agent-browser "${P[@]}" eval "document.body.innerText" | tail -40
