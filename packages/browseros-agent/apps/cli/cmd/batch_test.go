package cmd

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"browseros-cli/mcp"
)

type fakeToolCaller struct {
	calls []toolCall
	fail  map[int]error
}

func (f *fakeToolCaller) CallTool(name string, args map[string]any) (*mcp.ToolResult, error) {
	f.calls = append(f.calls, toolCall{name: name, args: args})
	if err := f.fail[len(f.calls)]; err != nil {
		return nil, err
	}
	return textResult("ok", map[string]any{"ok": true}), nil
}

func TestBatchCommandsInheritAndOverridePage(t *testing.T) {
	caller := &fakeToolCaller{}
	results := runBatchCommands(caller, []string{"press Enter", "-p 9 press Escape"}, batchOptions{
		page:    7,
		pageSet: true,
		bail:    true,
	})

	if failedBatch(results) {
		t.Fatalf("batch failed: %#v", results)
	}
	want := []toolCall{
		{name: "act", args: map[string]any{"page": 7, "kind": "press", "key": "Enter"}},
		{name: "act", args: map[string]any{"page": 9, "kind": "press", "key": "Escape"}},
	}
	if !reflect.DeepEqual(caller.calls, want) {
		t.Fatalf("calls = %#v, want %#v", caller.calls, want)
	}
}

func TestBatchBailStopsOnFirstFailure(t *testing.T) {
	caller := &fakeToolCaller{fail: map[int]error{1: errors.New("boom")}}
	results := runBatchCommands(caller, []string{"press Enter", "press Escape"}, batchOptions{
		page:    7,
		pageSet: true,
		bail:    true,
	})

	if len(results) != 1 {
		t.Fatalf("results = %d, want 1", len(results))
	}
	if !failedBatch(results) {
		t.Fatal("failedBatch() = false, want true")
	}
}

func TestBatchContinuesWithoutBail(t *testing.T) {
	caller := &fakeToolCaller{fail: map[int]error{1: errors.New("boom")}}
	results := runBatchCommands(caller, []string{"press Enter", "press Escape"}, batchOptions{
		page:    7,
		pageSet: true,
	})

	if len(results) != 2 {
		t.Fatalf("results = %d, want 2", len(results))
	}
	if !failedBatch(results) {
		t.Fatal("failedBatch() = false, want true")
	}
}

func TestBatchPreflightMissingPageBeforeSession(t *testing.T) {
	results := preflightBatchCommands([]string{"snapshot"}, batchOptions{})

	if len(results) != 1 {
		t.Fatalf("results = %d, want 1", len(results))
	}
	if results[0].OK {
		t.Fatal("preflight result OK = true, want false")
	}
	if !strings.Contains(results[0].Error, "page id is required") {
		t.Fatalf("error = %q, want missing page error", results[0].Error)
	}
}

func TestBatchPreflightRejectsInvalidFindNth(t *testing.T) {
	results := preflightBatchCommands([]string{"find --nth -1 text Buy click"}, batchOptions{
		page:    7,
		pageSet: true,
	})

	if len(results) != 1 {
		t.Fatalf("results = %d, want 1", len(results))
	}
	if !strings.Contains(results[0].Error, "--nth must be 1 or greater") {
		t.Fatalf("error = %q, want invalid nth error", results[0].Error)
	}
}

func TestBatchSnapshotFilters(t *testing.T) {
	got, err := batchSnapshotFilters([]string{"-i", "--compact", "--depth=3"})
	if err != nil {
		t.Fatalf("batchSnapshotFilters() error = %v", err)
	}
	if !got.interactive || !got.compact || got.depth != 3 {
		t.Fatalf("filters = %#v, want interactive compact depth 3", got)
	}

	if _, err := batchSnapshotFilters([]string{"--selector", "button"}); err == nil {
		t.Fatal("batchSnapshotFilters() error = nil, want unsupported flag error")
	}
}

func TestSplitBatchCommandPreservesQuotedArgs(t *testing.T) {
	got, err := splitBatchCommand(`find text "Add to Cart" click`)
	if err != nil {
		t.Fatalf("splitBatchCommand() error = %v", err)
	}
	want := []string{"find", "text", "Add to Cart", "click"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tokens = %#v, want %#v", got, want)
	}
}
