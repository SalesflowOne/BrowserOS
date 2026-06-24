package cmd

import (
	"fmt"

	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:         "dialog <accept|dismiss>",
		Annotations: map[string]string{"group": "Input:"},
		Short:       "Handle a JavaScript dialog",
		Args:        cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			action := args[0]
			if action != "accept" && action != "dismiss" {
				output.Errorf(3, "action must be 'accept' or 'dismiss', got: %s", action)
			}

			promptText, _ := cmd.Flags().GetString("text")

			c := newClient()
			pageID, err := resolvePageID(c)
			if err != nil {
				output.Error(err.Error(), 2)
			}

			promptArg := "undefined"
			if promptText != "" {
				promptArg = jsLiteral(promptText)
			}
			_, value, err := browserRunValue(c, fmt.Sprintf(
				`await browser.input(%d).handleDialog(%t, %s)
return { action: 'handle_dialog', page: %d, accept: %t }`,
				pageID,
				action == "accept",
				promptArg,
				pageID,
				action == "accept",
			))
			if err != nil {
				output.Error(err.Error(), 1)
			}
			message := "Dialog dismissed"
			if action == "accept" {
				message = "Dialog accepted"
			}
			result := textResult(message, resultData(value))
			if jsonOut {
				output.JSON(result)
			} else {
				output.Confirm(result.TextContent())
			}
		},
	}

	cmd.Flags().String("text", "", "Text for prompt dialogs")
	rootCmd.AddCommand(cmd)
}
