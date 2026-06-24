package cmd

import (
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:         "diff",
		Annotations: map[string]string{"group": "Observe:"},
		Short:       "Show what changed on the page since the last snapshot or diff",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}

			result, err := c.CallTool("diff", diffToolArgs(pageID))
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

	rootCmd.AddCommand(cmd)
}

func diffToolArgs(pageID int) map[string]any {
	return map[string]any{"page": pageID}
}
