package cmd

import (
	"fmt"

	"bdev/internal/engine"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var (
	exportCheckout string
	exportPaths    []string
	exportTag      string
)

var exportCmd = &cobra.Command{
	Use:     "export",
	Short:   "Export checkout changes back into chromium_patches",
	GroupID: "work",
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(exportCheckout)
		if err != nil {
			return err
		}
		patchCtx, err := loadPatchContext(record)
		if err != nil {
			return err
		}
		activity := ui.NewActivity(!jsonOutput)
		result, err := engine.Export(engine.NewContext(record, patchCtx), engine.ExportOpts{
			Paths:      exportPaths,
			TagFeature: exportTag,
		}, activity)
		if err != nil {
			return err
		}
		fmt.Println(ui.Title("bdev export"))
		fmt.Println()
		fmt.Printf("  %s %d\n", ui.Label("Updated patches:"), len(result.Updated))
		fmt.Printf("  %s %d\n", ui.Label("Removed patches:"), len(result.Removed))
		for _, warning := range result.Warnings {
			fmt.Printf("  %s %s\n", ui.Label("Warning:"), ui.Warn(warning))
		}
		return nil
	},
}

func init() {
	exportCmd.Flags().StringVar(&exportCheckout, "checkout", "", "checkout name or id")
	exportCmd.Flags().StringArrayVar(&exportPaths, "path", nil, "specific chromium path(s) to export")
	exportCmd.Flags().StringVar(&exportTag, "tag-feature", "", "optionally add touched files to a feature")
	rootCmd.AddCommand(exportCmd)
}
