package cmd

import (
	"encoding/json"
	"fmt"

	"bdev/internal/session"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var checkoutsCmd = &cobra.Command{
	Use:     "checkouts",
	Short:   "List registered Chromium checkouts",
	GroupID: "inspect",
	RunE: func(cmd *cobra.Command, args []string) error {
		type row struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			ChromiumRoot  string `json:"chromium_root"`
			BrowserOSRepo string `json:"browseros_repo"`
			LastSyncedRev string `json:"last_synced_rev,omitempty"`
			ActiveSession bool   `json:"active_session"`
		}
		rows := []row{}
		for _, checkout := range reg.Checkouts {
			_, err := session.Load(checkout.ID)
			rows = append(rows, row{
				ID:            checkout.ID,
				Name:          checkout.Name,
				ChromiumRoot:  checkout.ChromiumRoot,
				BrowserOSRepo: checkout.BrowserOSRepo,
				LastSyncedRev: checkout.LastSyncedRev,
				ActiveSession: err == nil,
			})
		}
		if jsonOutput {
			data, err := json.MarshalIndent(rows, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}
		fmt.Println(ui.Title("bdev checkouts"))
		fmt.Println()
		for _, checkout := range rows {
			sessionState := ui.Muted("idle")
			if checkout.ActiveSession {
				sessionState = ui.Warn("active session")
			}
			fmt.Printf("  %s %s  %s\n", ui.Value(checkout.Name), ui.Muted("("+checkout.ID+")"), sessionState)
			fmt.Printf("    %s %s\n", ui.Label("Chromium:"), checkout.ChromiumRoot)
			fmt.Printf("    %s %s\n", ui.Label("Repo:"), checkout.BrowserOSRepo)
			if checkout.LastSyncedRev != "" {
				fmt.Printf("    %s %s\n", ui.Label("Last sync:"), shortRev(checkout.LastSyncedRev))
			}
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(checkoutsCmd)
}
