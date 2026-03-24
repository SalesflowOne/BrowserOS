package cmd

import (
	"encoding/json"
	"fmt"

	"bdev/internal/session"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var conflictsCheckout string

var conflictsCmd = &cobra.Command{
	Use:     "conflicts",
	Short:   "Show active conflict session paths",
	GroupID: "repair",
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(conflictsCheckout)
		if err != nil {
			return err
		}
		sess, err := session.Load(record.ID)
		if err != nil {
			return err
		}
		if jsonOutput {
			data, err := json.MarshalIndent(sess, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}
		fmt.Println(ui.Title("bdev conflicts"))
		fmt.Println()
		fmt.Printf("  %s %s\n", ui.Label("Session:"), ui.Value(sess.Kind))
		for _, entry := range sess.Pending {
			fmt.Printf("  %s %s %s\n", ui.Warn("!"), entry.Path, ui.Muted("("+entry.Stage+")"))
		}
		return nil
	},
}

func init() {
	conflictsCmd.Flags().StringVar(&conflictsCheckout, "checkout", "", "checkout name or id")
	rootCmd.AddCommand(conflictsCmd)
}
