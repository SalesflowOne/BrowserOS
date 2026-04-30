package proc

import "testing"

func TestWatchProcessGroupsFromPSSelectsOtherWatchGroups(t *testing.T) {
	output := `
  111  111 /tmp/one/browseros-dev watch
  222  222 /tmp/two/browseros-dev watch --new
  333  333 /tmp/one/browseros-dev cleanup
  444  444 rg browseros-dev watch
  555  555 bun run dev:watch
`

	groups := watchProcessGroupsFromPS(output, 999)

	if len(groups) != 1 || groups[0] != 111 {
		t.Fatalf("expected only pgid 111, got %#v", groups)
	}
}

func TestWatchProcessGroupsFromPSDedupesProcessGroups(t *testing.T) {
	output := `
  111  111 /tmp/one/browseros-dev watch
  112  111 /tmp/one/browseros-dev watch
`

	groups := watchProcessGroupsFromPS(output, 999)

	if len(groups) != 1 || groups[0] != 111 {
		t.Fatalf("expected one pgid 111, got %#v", groups)
	}
}
