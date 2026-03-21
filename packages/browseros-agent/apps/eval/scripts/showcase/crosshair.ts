import type { Browser } from '@browseros/server/browser'

const CROSSHAIR_ID = '__browseros_showcase_crosshair__'

export async function injectCrosshair(
  browser: Browser,
  pageId: number,
  coords: { x: number; y: number },
  toolName: string,
): Promise<void> {
  const x = Math.round(coords.x)
  const y = Math.round(coords.y)
  const label = toolName.replace(/_/g, ' ')
  const labelWidth = Math.round(label.length * 7.5 + 16)

  await browser.evaluate(
    pageId,
    `(() => {
      const existing = document.getElementById('${CROSSHAIR_ID}');
      if (existing) existing.remove();

      const el = document.createElement('div');
      el.id = '${CROSSHAIR_ID}';
      el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
      el.innerHTML = '<svg style="position:absolute;top:0;left:0;width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">'
        + '<line x1="${x - 24}" y1="${y}" x2="${x + 24}" y2="${y}" stroke="#FF3B30" stroke-width="2" stroke-opacity="0.9"/>'
        + '<line x1="${x}" y1="${y - 24}" x2="${x}" y2="${y + 24}" stroke="#FF3B30" stroke-width="2" stroke-opacity="0.9"/>'
        + '<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="#FF3B30" stroke-width="2" stroke-opacity="0.9"/>'
        + '<circle cx="${x}" cy="${y}" r="3" fill="#FF3B30" fill-opacity="0.8"/>'
        + '<rect x="${x + 18}" y="${y - 22}" rx="4" ry="4" width="${labelWidth}" height="22" fill="rgba(0,0,0,0.75)"/>'
        + '<text x="${x + 26}" y="${y - 8}" font-family="system-ui,-apple-system,sans-serif" font-size="12" fill="white" font-weight="500">${label}</text>'
        + '</svg>';
      document.body.appendChild(el);
    })()`,
  )
}

export async function removeCrosshair(
  browser: Browser,
  pageId: number,
): Promise<void> {
  await browser.evaluate(
    pageId,
    `document.getElementById('${CROSSHAIR_ID}')?.remove()`,
  )
}
