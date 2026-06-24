package cmd

import (
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:         "snap",
		Annotations: map[string]string{"group": "Observe:"},
		Short:       "Snapshot interactive elements on the page",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			enhanced, _ := cmd.Flags().GetBool("enhanced")
			if enhanced {
				output.Error("snap --enhanced is not supported by the compact BrowserOS tool surface; use snap", 3)
			}

			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}

			result, err := c.CallTool("snapshot", map[string]any{"page": pageID})
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

	cmd.Flags().BoolP("enhanced", "e", false, "Unsupported by compact BrowserOS tools; exits with a migration error")
	rootCmd.AddCommand(cmd)
}
