# import-openclaw

Convert OpenClaw / ClawHub `SKILL.md` files into OWeb `ao_skills` playbook rows.

**Does not** port OpenClaw plugin runtime. **Does not** modify `lovable-chat.ts` — imported skills are picked up automatically via `loadActiveSkillsForOrg()`.

## Usage

```bash
# Single skill file
npx tsx skills/import-openclaw/import.ts \
  --input ./vendor/openclaw/extensions/slack/skills/slack/SKILL.md \
  --org <org-uuid> \
  --dry-run

# Directory of skills (recursive SKILL.md)
npx tsx skills/import-openclaw/import.ts \
  --input ./vendor/openclaw/extensions \
  --output ./tmp/imported-skills.json

# Dry-run prints JSON to stdout
npx tsx skills/import-openclaw/import.ts \
  --input ./vendor/openclaw/extensions/slack/skills/slack/SKILL.md \
  --dry-run
```

## Transform pipeline

1. Parse YAML frontmatter (`name`, `description`, `metadata.openclaw`)
2. Rewrite OpenClaw tool references using `mappings.json`
3. Append Prerequisites section from `requires.config`
4. Emit `ao_skills` payload with `source: openclaw-import`, `status: draft`, `enabled: false`
5. User reviews in Settings → Skills before enabling

## Frontmatter mapping

| OpenClaw | OWeb `ao_skills` |
|----------|------------------|
| `name` | `name` |
| `description` | `description` |
| body markdown | `content` |
| `metadata.openclaw.emoji` | prepended to description |
| `metadata.openclaw.requires.config` | appended Prerequisites section |
| — | `source: "openclaw-import"` |
| — | `status: "draft"`, `enabled: false` |

## Tool reference rewriting

See `mappings.json`. Examples:

| OpenClaw pattern | OWeb replacement |
|------------------|------------------|
| `` `slack` tool `` | Composio `search_tools` app=slack |
| `action: "sendMessage"` | `slack__SLACK_SEND_MESSAGE` |
| `` `browser` tool `` | `browser_tool__BROWSER_TOOL_*` |
| `openclaw browser doctor` | Removed (OpenClaw CLI — not applicable) |

## ClawHub

ClawHub skills use the same `SKILL.md` format. Clone or download the skill repo, then point `--input` at the skill directory.

## Tests

```bash
npm test -- skills/import-openclaw/import.test.ts
```
