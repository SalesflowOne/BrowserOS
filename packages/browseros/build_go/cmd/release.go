package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var releaseCmd = &cobra.Command{
	Use:         "release",
	Short:       "Release automation",
	Annotations: map[string]string{"group": "Release & Distribution:"},
	RunE: func(cmd *cobra.Command, args []string) error {
		return fmt.Errorf("not yet ported — use `uv run browseros release` meanwhile")
	},
}

func init() {
	rootCmd.AddCommand(releaseCmd)
}
