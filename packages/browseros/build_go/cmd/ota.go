package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var otaCmd = &cobra.Command{
	Use:         "ota",
	Short:       "OTA update automation",
	Annotations: map[string]string{"group": "Release & Distribution:"},
	RunE: func(cmd *cobra.Command, args []string) error {
		return fmt.Errorf("not yet ported — use `uv run browseros ota` meanwhile")
	},
}

func init() {
	rootCmd.AddCommand(otaCmd)
}
