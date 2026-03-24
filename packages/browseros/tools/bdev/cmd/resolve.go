package cmd

import (
	"fmt"
	"slices"

	"bdev/internal/registry"
	"bdev/internal/session"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var resolveCheckoutName string

var resolveCmd = &cobra.Command{
	Use:     "resolve <chromium/path>",
	Short:   "Mark a conflict path as resolved after manual repair",
	GroupID: "repair",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(resolveCheckoutName)
		if err != nil {
			return err
		}
		sess, err := session.Load(record.ID)
		if err != nil {
			return err
		}
		path := args[0]
		next := sess.Pending[:0]
		found := false
		for _, entry := range sess.Pending {
			if entry.Path == path {
				found = true
				sess.Resolved = append(sess.Resolved, entry.Path)
				continue
			}
			next = append(next, entry)
		}
		if !found {
			return fail("path %s is not pending in the active session", path)
		}
		slices.Sort(sess.Resolved)
		sess.Pending = next
		if len(next) == 0 {
			if err := session.Delete(record.ID); err != nil {
				return err
			}
			record.LastSyncedRev = sess.ToRepoRev
			record.LastOp = "resolve"
			reg.Upsert(*record)
			if err := registry.Save(reg); err != nil {
				return err
			}
		} else if err := session.Save(sess); err != nil {
			return err
		}
		fmt.Println(ui.Success("resolved"), path)
		return nil
	},
}

func init() {
	resolveCmd.Flags().StringVar(&resolveCheckoutName, "checkout", "", "checkout name or id")
	rootCmd.AddCommand(resolveCmd)
}
