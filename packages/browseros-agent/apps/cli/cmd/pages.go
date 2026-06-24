package cmd

import (
	"fmt"
	"strings"

	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	pagesCmd := &cobra.Command{
		Use:         "pages",
		Annotations: map[string]string{"group": "Navigate:"},
		Short:       "List all open pages (tabs)",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			_, value, err := browserRunValue(c, "return await browser.pages.list()")
			if err != nil {
				output.Error(err.Error(), 1)
			}
			pages := valueSlice(value)
			result := textResult(formatPages(pages), map[string]any{
				"pages": pages,
				"count": len(pages),
			})
			if jsonOut {
				output.JSON(result)
			} else {
				output.PageList(result)
			}
		},
	}

	activeCmd := &cobra.Command{
		Use:         "active",
		Annotations: map[string]string{"group": "Navigate:"},
		Short:       "Show the active (focused) page",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			_, value, err := browserRunValue(c, `const pages = await browser.pages.list()
const page = pages.find((p) => p.isActive) ?? pages[0]
if (!page) throw new Error('No active page found.')
return page`)
			if err != nil {
				output.Error(err.Error(), 1)
			}
			page, ok := valueMap(value)
			if !ok {
				output.Error("active page response was not an object", 1)
			}
			result := textResult(formatActivePage(page), map[string]any{"page": page})
			if jsonOut {
				output.JSON(result)
			} else {
				output.ActivePage(result)
			}
		},
	}

	closeCmd := &cobra.Command{
		Use:         "close [pageId]",
		Annotations: map[string]string{"group": "Navigate:"},
		Short:       "Close a page (tab)",
		Args:        cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			var pageID int
			var err error
			if len(args) > 0 {
				_, err = fmt.Sscanf(args[0], "%d", &pageID)
				if err != nil {
					output.Errorf(3, "invalid page ID: %s", args[0])
				}
			} else {
				pageID, err = resolvePageID(c)
				if err != nil {
					output.Error(err.Error(), 2)
				}
			}
			result, err := c.CallTool("tabs", map[string]any{
				"action": "close",
				"page":   pageID,
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

	rootCmd.AddCommand(pagesCmd, activeCmd, closeCmd)
}

func formatPages(pages []any) string {
	if len(pages) == 0 {
		return "No pages open."
	}
	lines := make([]string, 0, len(pages))
	for _, item := range pages {
		page, ok := valueMap(item)
		if !ok {
			continue
		}
		pageID := numberValue(page["pageId"])
		if pageID == 0 {
			pageID = numberValue(page["page"])
		}
		tabID := numberValue(page["tabId"])
		title := stringValue(page["title"])
		url := stringValue(page["url"])
		if title == "" {
			title = "(untitled)"
		}
		active := ""
		if isActive, _ := page["isActive"].(bool); isActive {
			active = " [ACTIVE]"
		}
		if tabID == 0 {
			lines = append(lines, fmt.Sprintf("%d. %s%s\n   %s", pageID, title, active, url))
		} else {
			lines = append(lines, fmt.Sprintf("%d. %s (tab %d)%s\n   %s", pageID, title, tabID, active, url))
		}
	}
	return strings.Join(lines, "\n\n")
}

func formatActivePage(page map[string]any) string {
	pageID := numberValue(page["pageId"])
	if pageID == 0 {
		pageID = numberValue(page["page"])
	}
	tabID := numberValue(page["tabId"])
	title := stringValue(page["title"])
	url := stringValue(page["url"])
	if tabID == 0 {
		return fmt.Sprintf("Active page: %d\n%s\n%s", pageID, title, url)
	}
	return fmt.Sprintf("Active page: %d (tab %d)\n%s\n%s", pageID, tabID, title, url)
}
