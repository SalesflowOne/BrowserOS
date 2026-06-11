package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var uploadCmd = &cobra.Command{
	Use:         "upload",
	Short:       "Upload third-party resources to R2",
	Annotations: map[string]string{"group": "Release & Distribution:"},
	RunE: func(cmd *cobra.Command, args []string) error {
		return fmt.Errorf("not yet ported — use `uv run browseros upload` meanwhile")
	},
}

func init() {
	rootCmd.AddCommand(uploadCmd)
}
