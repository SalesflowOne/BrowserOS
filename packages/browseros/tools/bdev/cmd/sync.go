package cmd

import (
	"fmt"

	"bdev/internal/engine"
	"bdev/internal/registry"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var syncCheckout string

var syncCmd = &cobra.Command{
	Use:     "sync",
	Short:   "Apply upstream patch-repo changes onto a clean checkout",
	GroupID: "work",
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(syncCheckout)
		if err != nil {
			return err
		}
		patchCtx, err := loadPatchContext(record)
		if err != nil {
			return err
		}
		activity := ui.NewActivity(!jsonOutput)
		result, err := engine.Sync(engine.NewContext(record, patchCtx), activity)
		if err != nil {
			return err
		}
		if result.Session == nil && result.RepoHead != "" {
			record.LastSyncedRev = result.RepoHead
		}
		record.LastOp = "sync"
		reg.Upsert(*record)
		if err := registry.Save(reg); err != nil {
			return err
		}
		fmt.Println(ui.Title("bdev sync"))
		fmt.Println()
		fmt.Printf("  %s %d\n", ui.Label("Updated paths:"), len(result.Updated))
		if result.Session != nil {
			fmt.Printf("  %s %d pending\n", ui.Label("Conflicts:"), len(result.Session.Pending))
			return fail("%d conflicts remain; run bdev conflicts", len(result.Session.Pending))
		}
		return nil
	},
}

func init() {
	syncCmd.Flags().StringVar(&syncCheckout, "checkout", "", "checkout name or id")
	rootCmd.AddCommand(syncCmd)
}
