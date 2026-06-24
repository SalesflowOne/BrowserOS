package cmd

import (
	"strings"

	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	fillCmd := &cobra.Command{
		Use:         "fill <ref> <value>",
		Annotations: map[string]string{"group": "Input:"},
		Short:       "Fill an input by snapshot ref",
		Args:        cobra.MinimumNArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			ref, err := elementRef(args[0])
			if err != nil {
				output.Error(err.Error(), 3)
			}
			value := strings.Join(args[1:], " ")
			noClear, _ := cmd.Flags().GetBool("no-clear")

			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}

			result, err := c.CallTool("act", fillToolArgs(pageID, ref, value, !noClear))
			if err != nil {
				output.Error(err.Error(), 1)
			}
			if jsonOut {
				output.JSON(result)
			} else {
				output.Confirm(result.TextContent())
			}
		},
	}
	fillCmd.Flags().Bool("no-clear", false, "Don't clear existing value before filling")

	clearCmd := &cobra.Command{
		Use:         "clear <ref>",
		Annotations: map[string]string{"group": "Input:"},
		Short:       "Clear an input by snapshot ref",
		Args:        cobra.ExactArgs(1),
		Run:         elementAction("fill", map[string]any{"value": "", "clear": true}),
	}

	keyCmd := &cobra.Command{
		Use:         "key <key>",
		Annotations: map[string]string{"group": "Input:"},
		Short:       "Press a key or key combination (e.g., Enter, Control+A)",
		Args:        cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}
			result, err := c.CallTool("act", map[string]any{
				"page": pageID,
				"kind": "press",
				"key":  args[0],
			})
			if err != nil {
				output.Error(err.Error(), 1)
			}
			if jsonOut {
				output.JSON(result)
			} else {
				output.Confirm(result.TextContent())
			}
		},
	}

	rootCmd.AddCommand(fillCmd, clearCmd, keyCmd)
}

func fillToolArgs(pageID int, ref, value string, clear bool) map[string]any {
	return map[string]any{
		"page":  pageID,
		"kind":  "fill",
		"ref":   ref,
		"value": value,
		"clear": clear,
	}
}
