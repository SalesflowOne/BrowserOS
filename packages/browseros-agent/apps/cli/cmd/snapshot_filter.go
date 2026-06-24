package cmd

import (
	"strings"

	"browseros-cli/mcp"
)

type snapshotFilterOptions struct {
	interactive bool
	compact     bool
	depth       int
}

func (o snapshotFilterOptions) applied() bool {
	return o.interactive || o.compact || o.depth > 0
}

func (o snapshotFilterOptions) metadata() map[string]any {
	filters := map[string]any{}
	if o.interactive {
		filters["interactive"] = true
	}
	if o.compact {
		filters["compact"] = true
	}
	if o.depth > 0 {
		filters["depth"] = o.depth
	}
	return filters
}

// snapshotOutputResult applies print-time filters while preserving the raw structured snapshot.
func snapshotOutputResult(result *mcp.ToolResult, pageID int, filters snapshotFilterOptions, jsonOutput bool) *mcp.ToolResult {
	text := result.TextContent()
	if filters.applied() {
		text = filterSnapshotText(text, filters)
	}
	text = displayElementRefs(text)

	data := map[string]any{}
	for key, value := range result.StructuredContent {
		data[key] = value
	}
	if _, ok := data["page"]; !ok {
		data["page"] = pageID
	}
	if jsonOutput && filters.applied() {
		data["filteredSnapshot"] = text
		data["filters"] = filters.metadata()
	}
	return textResult(text, data)
}

// filterSnapshotText removes snapshot rows that do not match the selected print filters.
func filterSnapshotText(text string, filters snapshotFilterOptions) string {
	lines := strings.Split(text, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if keepSnapshotLine(line, filters) {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

func keepSnapshotLine(line string, filters snapshotFilterOptions) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	if strings.HasPrefix(trimmed, "[UNTRUSTED_PAGE_CONTENT") || strings.HasPrefix(trimmed, "[END_UNTRUSTED_PAGE_CONTENT") {
		return true
	}
	if filters.depth > 0 && snapshotLineDepth(line) > filters.depth {
		return false
	}
	if filters.interactive && !snapshotLineInteractive(line) {
		return false
	}
	if filters.compact && snapshotLineStructuralOnly(line) {
		return false
	}
	return true
}

func snapshotLineDepth(line string) int {
	spaces := 0
	for _, r := range line {
		if r != ' ' {
			break
		}
		spaces++
	}
	return spaces / 2
}

func snapshotLineInteractive(line string) bool {
	switch lineRole(line) {
	case "button", "link", "input", "textbox", "combobox", "checkbox", "radio", "menuitem", "tab":
		return true
	default:
		return false
	}
}

func snapshotLineStructuralOnly(line string) bool {
	if _, ok := findLineRef(line); ok {
		return false
	}
	if strings.Contains(line, `"`) {
		return false
	}
	switch lineRole(line) {
	case "generic", "section", "group", "list", "listitem", "document", "webarea", "main", "navigation", "form", "region", "article":
		return true
	default:
		return false
	}
}
