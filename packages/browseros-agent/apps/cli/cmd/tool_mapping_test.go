package cmd

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"browseros-cli/mcp"
)

func TestCompactToolMappings(t *testing.T) {
	tests := []struct {
		name string
		got  map[string]any
		want map[string]any
	}{
		{
			name: "click",
			got:  clickToolArgs(7, "e12", "right", 2),
			want: map[string]any{
				"page":       7,
				"kind":       "click",
				"ref":        "e12",
				"button":     "right",
				"clickCount": 2,
			},
		},
		{
			name: "click at",
			got:  clickAtToolArgs(7, 10, 20),
			want: map[string]any{
				"page": 7,
				"kind": "click_at",
				"x":    10,
				"y":    20,
			},
		},
		{
			name: "list tabs",
			got:  tabsListToolArgs(),
			want: map[string]any{"action": "list"},
		},
		{
			name: "open tab",
			got:  openTabsToolArgs("https://example.com", true, false),
			want: map[string]any{
				"action":     "new",
				"url":        "https://example.com",
				"hidden":     true,
				"background": false,
			},
		},
		{
			name: "pdf",
			got:  pdfToolArgs(7),
			want: map[string]any{"page": 7},
		},
		{
			name: "diff",
			got:  diffToolArgs(7),
			want: map[string]any{"page": 7},
		},
		{
			name: "download",
			got:  downloadToolArgs(7, "e12"),
			want: map[string]any{
				"page": 7,
				"ref":  "e12",
			},
		},
		{
			name: "fill",
			got:  fillToolArgs(7, "e12", "hello", true),
			want: map[string]any{
				"page":  7,
				"kind":  "fill",
				"ref":   "e12",
				"value": "hello",
				"clear": true,
			},
		},
		{
			name: "fill without clear",
			got:  fillToolArgs(7, "e12", "hello", false),
			want: map[string]any{
				"page":  7,
				"kind":  "fill",
				"ref":   "e12",
				"value": "hello",
				"clear": false,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !reflect.DeepEqual(tt.got, tt.want) {
				t.Fatalf("mapping = %#v, want %#v", tt.got, tt.want)
			}
		})
	}
}

func TestTabsListResultKeepsLegacyShape(t *testing.T) {
	result := tabsListResult(&mcp.ToolResult{
		StructuredContent: map[string]any{
			"pages": []any{
				map[string]any{"page": 42, "url": "https://example.com", "title": "Example"},
			},
		},
	})

	if got := result.StructuredContent["count"]; got != 1 {
		t.Fatalf("count = %v, want 1", got)
	}
	pages, ok := result.StructuredContent["pages"].([]any)
	if !ok || len(pages) != 1 {
		t.Fatalf("pages = %#v, want one page", result.StructuredContent["pages"])
	}
	page, ok := pages[0].(map[string]any)
	if !ok {
		t.Fatalf("page = %#v, want map", pages[0])
	}
	if got := numberValue(page["pageId"]); got != 42 {
		t.Fatalf("pageId = %d, want 42", got)
	}
}

func TestOpenInWindowCodeUsesCompactRunBridge(t *testing.T) {
	code := openInWindowCode("https://example.com/?q=one two", true, false, 9)
	for _, want := range []string{
		"browser.pages.newPage",
		`"https://example.com/?q=one two"`,
		"hidden: true",
		"background: false",
		"windowId: 9",
	} {
		if !strings.Contains(code, want) {
			t.Fatalf("openInWindowCode() missing %q in:\n%s", want, code)
		}
	}
}

func TestScreenshotToolArgsRejectsUnsupportedQualityFormat(t *testing.T) {
	_, err := screenshotToolArgs(7, "webp", false, 20, true)
	if err == nil {
		t.Fatal("screenshotToolArgs() error = nil, want unsupported quality error")
	}

	got, err := screenshotToolArgs(7, "jpeg", true, 80, true)
	if err != nil {
		t.Fatalf("screenshotToolArgs() error = %v", err)
	}
	want := map[string]any{
		"page":     7,
		"format":   "jpeg",
		"fullPage": true,
		"quality":  80,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("screenshot args = %#v, want %#v", got, want)
	}
}

func TestCopyDownloadFileRejectsUnsafeNames(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	for _, filename := range []string{"", ".", "..", "../report.csv", "nested/report.csv", `nested\report.csv`, "/tmp/report.csv"} {
		t.Run(filename, func(t *testing.T) {
			if _, err := copyDownloadFile(src, dir, filename); err == nil {
				t.Fatalf("copyDownloadFile(%q) error = nil, want unsafe filename error", filename)
			}
		})
	}
}

func TestCopyDownloadFileAvoidsOverwrite(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source")
	if err := os.WriteFile(src, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(dir, "report.csv")
	if err := os.WriteFile(existing, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	dst, err := copyDownloadFile(src, dir, "report.csv")
	if err != nil {
		t.Fatalf("copyDownloadFile() error = %v", err)
	}
	if filepath.Base(dst) != "report-1.csv" {
		t.Fatalf("destination = %q, want report-1.csv suffix", dst)
	}
	existingData, err := os.ReadFile(existing)
	if err != nil {
		t.Fatal(err)
	}
	if string(existingData) != "old" {
		t.Fatalf("existing file = %q, want old", existingData)
	}
	newData, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(newData) != "new" {
		t.Fatalf("copied file = %q, want new", newData)
	}
}
