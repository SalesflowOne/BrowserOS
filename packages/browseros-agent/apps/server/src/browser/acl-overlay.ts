import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { AclRule } from '@browseros/shared/types/acl'

const OVERLAY_STYLE_ID = 'browseros-acl-overlay-style'

const OVERLAY_CSS = `
.browseros-acl-blocked-overlay {
  position: absolute;
  background: rgba(220, 38, 38, 0.25);
  border: 2px solid rgba(220, 38, 38, 0.8);
  border-radius: 4px;
  pointer-events: none;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: rgba(220, 38, 38, 0.9);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.browseros-acl-blocked-overlay::after {
  content: "BLOCKED";
  background: rgba(255, 255, 255, 0.85);
  padding: 2px 6px;
  border-radius: 2px;
}
`

export async function applyAclOverlays(
  session: ProtocolApi,
  rules: AclRule[],
): Promise<number> {
  const rulesJson = JSON.stringify(rules)
  const cssJson = JSON.stringify(OVERLAY_CSS)
  const styleIdJson = JSON.stringify(OVERLAY_STYLE_ID)

  const result = await session.Runtime.evaluate({
    expression: `(function() {
  var rules = ${rulesJson};
  var css = ${cssJson};
  var styleId = ${styleIdJson};
  document.querySelectorAll('.browseros-acl-blocked-overlay').forEach(function(el) { el.remove(); });
  if (!document.getElementById(styleId)) {
    var s = document.createElement('style');
    s.id = styleId;
    s.textContent = css;
    document.head.appendChild(s);
  }
  var count = 0;
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var selector = rule.selector || '*';
    try {
      var elements = document.querySelectorAll(selector);
      for (var j = 0; j < elements.length; j++) {
        var el = elements[j];
        var text = el.textContent || '';
        if (rule.textMatch && text.toLowerCase().indexOf(rule.textMatch.toLowerCase()) === -1) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        var overlay = document.createElement('div');
        overlay.className = 'browseros-acl-blocked-overlay';
        overlay.style.left = (rect.left + window.scrollX) + 'px';
        overlay.style.top = (rect.top + window.scrollY) + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        document.body.appendChild(overlay);
        count++;
      }
    } catch(e) {}
  }
  return count;
})()`,
    returnByValue: true,
  })

  return (result.result?.value as number) ?? 0
}

export async function clearAclOverlays(session: ProtocolApi): Promise<void> {
  await session.Runtime.evaluate({
    expression: `document.querySelectorAll('.browseros-acl-blocked-overlay').forEach(function(el) { el.remove(); })`,
  })
}
