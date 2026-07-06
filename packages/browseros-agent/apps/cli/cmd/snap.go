package cmd

import (
	"browseros-cli/mcp"
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:         "snapshot",
		Aliases:     []string{"snap"},
		Annotations: map[string]string{"group": "Observe:"},
		Short:       "Capture the page accessibility tree",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			pageID, err := resolvePageID(nil)
			if err != nil {
				output.Error(err.Error(), 2)
			}
			c := newClient()

			result, err := c.CallTool("snapshot", map[string]any{"page": pageID})
			if err != nil {
				output.Error(err.Error(), 1)
			}
			result = snapshotResult(pageID, result)
			if jsonOut {
				output.JSON(result)
			} else {
				output.Text(result)
			}
		},
	}

	rootCmd.AddCommand(cmd)
}

func snapshotResult(pageID int, result *mcp.ToolResult) *mcp.ToolResult {
	text := displayElementRefs(result.TextContent())
	data := make(map[string]any, len(result.StructuredContent)+2)
	for key, value := range result.StructuredContent {
		data[key] = value
	}

	data["page"] = pageID
	if snapshot, ok := data["snapshot"].(string); ok {
		data["snapshot"] = displayElementRefs(snapshot)
	} else {
		data["snapshot"] = text
	}

	return textResult(text, data)
}
