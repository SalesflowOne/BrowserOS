package cmd

import (
	"bytes"
	"strings"
	"testing"
)

func TestPrintInitNextStepsShowsInlineAndBackgroundStart(t *testing.T) {
	var out bytes.Buffer
	printInitNextSteps(&out, "/tmp/config.yaml")

	got := out.String()
	for _, want := range []string{
		"Config written: /tmp/config.yaml",
		"Inline:     browseros-dogfood start",
		"Background: browseros-dogfood start-background",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in\n%s", want, got)
		}
	}
}
