package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var devCmd = &cobra.Command{
	Use:         "dev",
	Short:       "Dev patch management",
	Annotations: map[string]string{"group": "Development:"},
	RunE: func(cmd *cobra.Command, args []string) error {
		return fmt.Errorf("not yet ported — use `uv run browseros dev` meanwhile")
	},
}

func init() {
	rootCmd.AddCommand(devCmd)
}
