package cmd

import (
	"fmt"
	"strings"

	"browseros-cli/mcp"
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	domCmd := &cobra.Command{
		Use:         "dom",
		Annotations: map[string]string{"group": "Observe:"},
		Short:       "Get raw HTML DOM structure",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			selector, _ := cmd.Flags().GetString("selector")

			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}

			code := "const root = document.documentElement\nif (!root) throw new Error('Page has no DOM content.')\nreturn root.outerHTML"
			if selector != "" {
				code = fmt.Sprintf(
					"const root = document.querySelector(%s)\nif (!root) throw new Error(%s)\nreturn root.outerHTML",
					jsLiteral(selector),
					jsLiteral(fmt.Sprintf("No element found matching %q.", selector)),
				)
			}

			result, err := c.CallTool("evaluate", map[string]any{
				"page": pageID,
				"code": code,
			})
			if err != nil {
				output.Error(err.Error(), 1)
			}
			if jsonOut {
				output.JSON(result)
			} else {
				output.Text(result)
			}
		},
	}
	domCmd.Flags().String("selector", "", "CSS selector to scope")

	domSearchCmd := &cobra.Command{
		Use:         "dom-search <query>",
		Annotations: map[string]string{"group": "Observe:"},
		Short:       "Search DOM by text, CSS selector, or XPath",
		Args:        cobra.MinimumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			query := strings.Join(args, " ")
			limit, _ := cmd.Flags().GetInt("limit")

			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}

			result, err := c.CallTool("evaluate", map[string]any{
				"page": pageID,
				"code": domSearchScript(query, limit),
			})
			if err != nil {
				output.Error(err.Error(), 1)
			}
			result = domSearchResult(query, result)
			if jsonOut {
				output.JSON(result)
			} else {
				output.Text(result)
			}
		},
	}
	domSearchCmd.Flags().Int("limit", 25, "Max results")

	rootCmd.AddCommand(domCmd, domSearchCmd)
}

// domSearchScript preserves the CLI's CSS/XPath/text search behavior through evaluate.
func domSearchScript(query string, limit int) string {
	return fmt.Sprintf(`
const query = %s
const limit = %d
let nodes = []
try {
  nodes = Array.from(document.querySelectorAll(query))
} catch {}
if (nodes.length === 0 && query.startsWith('/')) {
  const result = document.evaluate(query, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
  nodes = Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i)).filter(Boolean)
}
if (nodes.length === 0) {
  const needle = query.toLowerCase()
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if ((node.textContent || '').toLowerCase().includes(needle)) nodes.push(node)
  }
}
const shown = nodes.slice(0, limit).map((node) => ({
  tag: node.tagName ? node.tagName.toLowerCase() : '',
  text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
  id: node.id || '',
  className: typeof node.className === 'string' ? node.className : '',
}))
return { query, totalCount: nodes.length, shownCount: shown.length, results: shown }
`, jsLiteral(query), limit)
}

func domSearchResult(query string, result *mcp.ToolResult) *mcp.ToolResult {
	value, ok := result.StructuredContent["value"].(map[string]any)
	if !ok {
		return result
	}
	results := valueSlice(value["results"])
	if len(results) == 0 {
		return textResult(fmt.Sprintf("No elements matching %q found.", query), value)
	}

	lines := []string{fmt.Sprintf("Found %d matching elements:", numberValue(value["totalCount"])), ""}
	for _, item := range results {
		row, ok := valueMap(item)
		if !ok {
			continue
		}
		label := stringValue(row["tag"])
		if id := stringValue(row["id"]); id != "" {
			label += "#" + id
		}
		if className := stringValue(row["className"]); className != "" {
			label += "." + strings.Join(strings.Fields(className), ".")
		}
		lines = append(lines, label)
		if text := stringValue(row["text"]); text != "" {
			lines = append(lines, "  "+text)
		}
	}
	return textResult(strings.Join(lines, "\n"), value)
}
