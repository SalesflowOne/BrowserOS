package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var buildCmd = &cobra.Command{
	Use:         "build",
	Short:       "Build BrowserOS browser",
	Annotations: map[string]string{"group": "Build:"},
	RunE: func(cmd *cobra.Command, args []string) error {
		return fmt.Errorf("not yet ported — use `uv run browseros build` meanwhile")
	},
}

func init() {
	rootCmd.AddCommand(buildCmd)
}
