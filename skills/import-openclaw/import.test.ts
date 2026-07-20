import { describe, expect, it } from "vitest";
import { convertOpenClawSkill, rewriteSkillBody } from "./import";

const SLACK_SAMPLE = `---
name: slack
description: "Slack tool actions"
metadata: { "openclaw": { "emoji": "chat", "requires": { "config": ["channels.slack"] } } }
---

# Slack

Use the \`slack\` tool.

\`\`\`json
{ "action": "sendMessage", "to": "channel:C123", "content": "Hello" }
\`\`\`
`;

const BROWSER_SAMPLE = `---
name: browser-automation
description: Browser control
user-invocable: false
---

Use the \`browser\` tool with action="snapshot".
Run openclaw browser doctor if broken.
`;

describe("import-openclaw", () => {
  it("converts slack skill with prerequisites", () => {
    const row = convertOpenClawSkill(SLACK_SAMPLE, { sourcePath: "slack/SKILL.md" });
    expect(row.name).toBe("slack");
    expect(row.status).toBe("draft");
    expect(row.enabled).toBe(false);
    expect(row.source).toBe("openclaw-import");
    expect(row.content).toContain("channels.slack");
    expect(row.content).toContain("search_tools");
  });

  it("rewrites browser tool references", () => {
    const body = rewriteSkillBody(BROWSER_SAMPLE.split("---").pop()!);
    expect(body.toLowerCase()).toContain("browser_tool");
    expect(body).not.toMatch(/openclaw browser doctor/i);
  });
});
