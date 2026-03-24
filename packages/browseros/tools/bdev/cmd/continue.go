package cmd

import (
	"fmt"

	"bdev/internal/engine"
	"bdev/internal/registry"
	"bdev/internal/session"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var continueCheckout string

var continueCmd = &cobra.Command{
	Use:     "continue",
	Short:   "Retry pending conflict session patches",
	GroupID: "repair",
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(continueCheckout)
		if err != nil {
			return err
		}
		sess, err := session.Load(record.ID)
		if err != nil {
			return err
		}
		patchCtx, err := loadPatchContext(record)
		if err != nil {
			return err
		}
		activity := ui.NewActivity(!jsonOutput)
		result, err := engine.Continue(engine.NewContext(record, patchCtx), activity)
		if err != nil {
			return err
		}
		if result.Remaining == 0 {
			record.LastSyncedRev = sess.ToRepoRev
		}
		record.LastOp = "continue"
		reg.Upsert(*record)
		if err := registry.Save(reg); err != nil {
			return err
		}
		fmt.Println(ui.Title("bdev continue"))
		fmt.Println()
		fmt.Printf("  %s %d\n", ui.Label("Remaining conflicts:"), result.Remaining)
		if result.Remaining > 0 {
			return fail("%d conflicts remain", result.Remaining)
		}
		return nil
	},
}

func init() {
	continueCmd.Flags().StringVar(&continueCheckout, "checkout", "", "checkout name or id")
	rootCmd.AddCommand(continueCmd)
}
