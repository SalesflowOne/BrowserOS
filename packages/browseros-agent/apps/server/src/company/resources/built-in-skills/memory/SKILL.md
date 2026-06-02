---
name: memory
description: Read and write the durable file-based memory system. MEMORY.md is the workspace-root INDEX of pointers; life/ holds the actual content as PARA folders; memory/YYYY-MM-DD.md holds today's scratch. Use whenever you need to save, recall, or organize anything that should outlast this conversation.
---

# memory — durable workspace memory

Your in-memory context dies when this session ends. Files in your
workspace survive. This skill is how you keep continuity.

## 1. The three layers

| File                             | Lifetime                  | Read when                                | Write when                                            |
|----------------------------------|---------------------------|------------------------------------------|-------------------------------------------------------|
| `./SOUL.md`                      | Identity / voice          | Start of every conversation              | Only when the user changes your role or boundaries    |
| `./MEMORY.md`                    | Promoted, canonical       | Start of every conversation              | A new pointer is created, OR a canonical preference   |
| `./life/<PARA>/<x>/MEMORY.md`    | Topic-scoped, durable     | Starting a task that touches that topic  | You learned something specific to that topic         |
| `./memory/YYYY-MM-DD.md`         | Today's scratch           | You've lost track in a long thread       | Continuously, as breadcrumbs                          |

**Architecture in one line:** `MEMORY.md` is an **index of pointers**,
not a content dump. Content lives in `./life/` under PARA folders.

## 2. ALWAYS: read at the start

Before your first reply in a new conversation, read `./SOUL.md` and
`./MEMORY.md`. If `MEMORY.md` is empty, that's expected — the user is
new to you.

## 3. Where to write a learning — decision matrix

| What you learned                                       | Where it goes                                                | Touch `./MEMORY.md`?                          |
|--------------------------------------------------------|--------------------------------------------------------------|-----------------------------------------------|
| Canonical user preference                              | `./MEMORY.md` § Preferences                                  | (the write IS the touch)                      |
| Site-specific browser quirk                            | `./life/resources/browseros/<site>/MEMORY.md`                | Only when creating that file for the first time |
| Cross-site BrowserOS tool quirk                        | `./life/resources/browseros/MEMORY.md`                       | Only when creating that file for the first time |
| Project status, decision, deadline                     | `./life/projects/<name>/summary.md` + `items.yaml`           | Only when creating that folder                |
| Person or company fact                                 | `./life/areas/{people,companies}/<name>/items.yaml`          | Only when creating that folder                |
| Today's ephemeral observation                          | `./memory/YYYY-MM-DD.md`                                     | Never                                         |

`MEMORY.md` is touched only when a new pointer is created. Appending
to an existing file does NOT require updating `MEMORY.md`.

## 4. ALWAYS: write as you learn, not "at session end"

Trigger a write the moment you observe a durable fact. Chat sessions
don't have clean ends — "I'll write that later" is unreliable. A turn
that surfaced a learning should not move on until the learning is
recorded.

## 5. ALWAYS: supersede, never delete

When a fact changes, mark the old entry `status: superseded` with
`superseded_by: <new-id>`. Keep history.

## 6. Promotion: daily note → MEMORY.md / life/

- Daily notes are short-term evidence.
- Re-read today's note before promoting — entries may have been edited.
- Promote stable patterns; leave one-offs in the daily note.
- Merge with existing entries; don't duplicate.

## 7. When to create a new `life/` folder

| Trigger                                                            | Folder                                          |
|--------------------------------------------------------------------|-------------------------------------------------|
| Site or topic hit 2+ times                                         | `./life/resources/<topic>/`                     |
| Project with a goal or deadline                                    | `./life/projects/<name>/`                       |
| Person/company mentioned 3+ times, or direct relationship to user  | `./life/areas/{people,companies}/<name>/`       |

Until one of these fires, the observation stays in today's daily note.

## 8. MEMORY.md structure (once you start writing)

The file is seeded empty. As you accumulate content, organize it
under three headings:

```markdown
## Preferences
(One bullet per canonical user preference.)

## Where things live
(One bullet per `life/` pointer you've created. Sorted by area.)

## Recent additions
(Most-recent-first log of folders/files you created. Cap at ~10.)
```

Keep the whole file under ~100 lines. When a section grows, move the
content into `life/` and what stays here is a pointer to it.

## 9. items.yaml schema

For atomic, supersede-able facts under `life/projects/<name>/`,
`life/areas/<kind>/<name>/`, etc.:

```yaml
- id: entity-001
  fact: "the fact"
  category: relationship | milestone | status | preference | quirk
  timestamp: "YYYY-MM-DD"
  status: active
  superseded_by: null
```

## 10. Worked example

> **User says:** "I shop on amazon.com but my account defaults to
> India delivery."

Two durable signals — record both before continuing:

1. **Canonical preference** — append to `./MEMORY.md` § Preferences:
   `Amazon: use amazon.com, ship to US address`
2. **Site quirk** — create
   `./life/resources/browseros/amazon/MEMORY.md` with the
   browseros-skill's seed structure, and under § Auth & session add:
   `Account defaults to "Deliver to India" — set US shipping address before checkout.`
3. **Pointer** — append to `./MEMORY.md` § "Where things live":
   `Amazon → ./life/resources/browseros/amazon/MEMORY.md`
4. **Recent additions** — append:
   `YYYY-MM-DD — life/resources/browseros/amazon/MEMORY.md`

Then continue the task.

## 11. NEVER

- Secrets, credentials, API tokens, passwords.
- Raw transcripts (paraphrase instead).
- One-off facts that didn't generalize (stay in the daily note).
- Behavior or identity rules (those belong in SOUL.md).
- Memory anywhere other than this workspace. If your underlying
  runtime has a default memory or state location (e.g.
  `~/.claude/`, a Codex session dir, a Gemini state cache),
  ignore it — BrowserClaw persistence lives only in `./`.
