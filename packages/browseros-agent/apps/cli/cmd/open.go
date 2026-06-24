package cmd

import (
	"fmt"

	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:         "open <url>",
		Annotations: map[string]string{"group": "Navigate:"},
		Short:       "Open a new page (tab) and navigate to a URL",
		Args:        cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			hidden, _ := cmd.Flags().GetBool("hidden")
			bg, _ := cmd.Flags().GetBool("bg")
			windowID, _ := cmd.Flags().GetInt("window")

			c := newClient()
			var resultText string
			var resultData map[string]any
			var err error
			var result any

			if cmd.Flags().Changed("window") {
				_, result, err = browserRunValue(c, openInWindowCode(args[0], hidden, bg, windowID))
				if err == nil {
					resultData, _ = valueMap(result)
					resultText = fmt.Sprintf("opened page %d", numberValue(resultData["page"]))
				}
			} else {
				toolResult, callErr := c.CallTool("tabs", openTabsToolArgs(args[0], hidden, bg))
				err = callErr
				if err == nil {
					resultText = toolResult.TextContent()
					resultData = toolResult.StructuredContent
				}
			}

			if err != nil {
				output.Error(err.Error(), 1)
			}
			resultForOutput := textResult(resultText, resultData)
			if jsonOut {
				output.JSON(resultForOutput)
			} else {
				output.Confirm(resultForOutput.TextContent())
			}
		},
	}

	cmd.Flags().Bool("hidden", false, "Open as hidden tab")
	cmd.Flags().Bool("bg", false, "Open in background")
	cmd.Flags().Int("window", 0, "Window ID to open in")

	rootCmd.AddCommand(cmd)
}

func openTabsToolArgs(url string, hidden, background bool) map[string]any {
	return map[string]any{
		"action":     "new",
		"url":        url,
		"hidden":     hidden,
		"background": background,
	}
}

func openInWindowCode(url string, hidden, background bool, windowID int) string {
	return fmt.Sprintf(
		`const page = await browser.pages.newPage(%s, { hidden: %t, background: %t, windowId: %d })
return { page, url: %s, hidden: %t, background: %t, windowId: %d }`,
		jsLiteral(url),
		hidden,
		background,
		windowID,
		jsLiteral(url),
		hidden,
		background,
		windowID,
	)
}
