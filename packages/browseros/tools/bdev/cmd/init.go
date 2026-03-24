package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"bdev/internal/git"
	"bdev/internal/patchrepo"
	"bdev/internal/registry"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var (
	initPatchesRepo string
	initName        string
)

var initCmd = &cobra.Command{
	Use:     "init",
	Short:   "Register the current Chromium checkout",
	GroupID: "setup",
	RunE: func(cmd *cobra.Command, args []string) error {
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		if !looksLikeChromium(cwd) {
			return fail("current directory does not look like a Chromium checkout")
		}
		patchCtx, err := patchrepo.Load(initPatchesRepo)
		if err != nil {
			return err
		}
		root, err := git.Root(cwd)
		if err != nil {
			return err
		}
		if !git.CommitExists(root, patchCtx.BaseCommit) {
			return fail("BASE_COMMIT %s not found in checkout history", patchCtx.BaseCommit)
		}
		name := initName
		if name == "" {
			name = filepath.Base(root)
		}
		record := reg.Upsert(registry.CheckoutRecord{
			Name:          name,
			ChromiumRoot:  root,
			BrowserOSRepo: patchCtx.BrowserOSRepo,
			BaseCommit:    patchCtx.BaseCommit,
			LastOp:        "init",
		})
		if err := registry.Save(reg); err != nil {
			return err
		}
		fmt.Println(ui.Title("bdev init"))
		fmt.Println()
		fmt.Printf("  %s %s\n", ui.Label("Checkout:"), ui.Value(record.Name))
		fmt.Printf("  %s %s\n", ui.Label("ID:"), ui.Value(record.ID))
		fmt.Printf("  %s %s\n", ui.Label("Chromium:"), ui.Value(record.ChromiumRoot))
		fmt.Printf("  %s %s\n", ui.Label("BrowserOS repo:"), ui.Value(record.BrowserOSRepo))
		fmt.Printf("  %s %s\n", ui.Label("Base commit:"), ui.Value(shortRev(record.BaseCommit)))
		return nil
	},
}

func init() {
	initCmd.Flags().StringVar(&initPatchesRepo, "patches-repo", ".", "path to BrowserOS repo")
	initCmd.Flags().StringVar(&initName, "name", "", "human-friendly checkout name")
	rootCmd.AddCommand(initCmd)
}
