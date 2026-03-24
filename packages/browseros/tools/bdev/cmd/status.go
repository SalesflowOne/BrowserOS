package cmd

import (
	"encoding/json"
	"fmt"

	"bdev/internal/git"
	"bdev/internal/session"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var statusCheckout string

var statusCmd = &cobra.Command{
	Use:     "status",
	Short:   "Show status for a registered checkout",
	GroupID: "inspect",
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(statusCheckout)
		if err != nil {
			return err
		}
		patchCtx, err := loadPatchContext(record)
		if err != nil {
			return err
		}
		localChanges, err := git.DiffNameStatus(record.ChromiumRoot, patchCtx.BaseCommit)
		if err != nil {
			return err
		}
		repoHead, err := git.HeadRev(record.BrowserOSRepo)
		if err != nil {
			return err
		}
		repoDirty, err := git.IsDirty(record.BrowserOSRepo)
		if err != nil {
			return err
		}
		sess, _ := session.Load(record.ID)
		payload := map[string]any{
			"id":             record.ID,
			"name":           record.Name,
			"chromium_root":  record.ChromiumRoot,
			"browseros_repo": record.BrowserOSRepo,
			"base_commit":    record.BaseCommit,
			"repo_head":      repoHead,
			"repo_dirty":     repoDirty,
			"local_changes":  len(localChanges),
			"last_synced":    record.LastSyncedRev,
			"active_session": sess != nil,
		}
		if jsonOutput {
			data, err := json.MarshalIndent(payload, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}
		fmt.Println(ui.Title("bdev status"))
		fmt.Println()
		fmt.Printf("  %s %s\n", ui.Label("Checkout:"), ui.Value(record.Name))
		fmt.Printf("  %s %s\n", ui.Label("Chromium:"), ui.Value(record.ChromiumRoot))
		fmt.Printf("  %s %s\n", ui.Label("BrowserOS repo:"), ui.Value(record.BrowserOSRepo))
		fmt.Printf("  %s %s\n", ui.Label("Base commit:"), ui.Value(shortRev(record.BaseCommit)))
		fmt.Printf("  %s %s\n", ui.Label("Repo head:"), ui.Value(shortRev(repoHead)))
		if patchCtx.ChromiumVersion != "" {
			fmt.Printf("  %s %s\n", ui.Label("Chromium version:"), ui.Value(patchCtx.ChromiumVersion))
		}
		fmt.Printf("  %s %d\n", ui.Label("Local changes:"), len(localChanges))
		if record.LastSyncedRev != "" {
			fmt.Printf("  %s %s\n", ui.Label("Last sync:"), ui.Value(shortRev(record.LastSyncedRev)))
		}
		if repoDirty {
			fmt.Printf("  %s %s\n", ui.Label("Patch repo state:"), ui.Warn("dirty"))
		}
		if sess != nil {
			fmt.Printf("  %s %s (%d pending)\n", ui.Label("Session:"), ui.Warn(sess.Kind), len(sess.Pending))
		}
		return nil
	},
}

func init() {
	statusCmd.Flags().StringVar(&statusCheckout, "checkout", "", "checkout name or id")
	rootCmd.AddCommand(statusCmd)
}

func shortRev(rev string) string {
	if len(rev) <= 12 {
		return rev
	}
	return rev[:12]
}
