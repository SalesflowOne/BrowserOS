package cmd

import (
	"fmt"

	"bdev/internal/engine"
	"bdev/internal/registry"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var (
	applyCheckout string
	applyClean    bool
	applyAll      bool
	applyTag      string
)

var applyCmd = &cobra.Command{
	Use:     "apply",
	Short:   "Apply BrowserOS patches into a checkout",
	GroupID: "work",
	RunE: func(cmd *cobra.Command, args []string) error {
		if !applyAll {
			return fail("only --all is supported")
		}
		record, err := resolveCheckout(applyCheckout)
		if err != nil {
			return err
		}
		patchCtx, err := loadPatchContext(record)
		if err != nil {
			return err
		}
		activity := ui.NewActivity(!jsonOutput)
		result, err := engine.ApplyAll(engine.NewContext(record, patchCtx), engine.ApplyAllOpts{
			Clean:      applyClean,
			TagFeature: applyTag,
		}, activity)
		if err != nil {
			return err
		}
		if result.Session == nil {
			record.LastSyncedRev = result.RepoHead
		}
		record.LastOp = "apply"
		reg.Upsert(*record)
		if err := registry.Save(reg); err != nil {
			return err
		}
		fmt.Println(ui.Title("bdev apply"))
		fmt.Println()
		fmt.Printf("  %s %d\n", ui.Label("Applied:"), len(result.Applied))
		fmt.Printf("  %s %d\n", ui.Label("Deleted:"), len(result.Deleted))
		if result.Session != nil {
			fmt.Printf("  %s %d pending\n", ui.Label("Conflicts:"), len(result.Session.Pending))
			return fail("%d conflicts remain; run bdev conflicts", len(result.Session.Pending))
		}
		for _, warning := range result.Warnings {
			fmt.Printf("  %s %s\n", ui.Label("Warning:"), ui.Warn(warning))
		}
		return nil
	},
}

func init() {
	applyCmd.Flags().StringVar(&applyCheckout, "checkout", "", "checkout name or id")
	applyCmd.Flags().BoolVar(&applyAll, "all", false, "apply the full patch set")
	applyCmd.Flags().BoolVar(&applyClean, "clean", false, "reset checkout to base before apply")
	applyCmd.Flags().StringVar(&applyTag, "tag-feature", "", "optionally add touched files to a feature")
	rootCmd.AddCommand(applyCmd)
}
