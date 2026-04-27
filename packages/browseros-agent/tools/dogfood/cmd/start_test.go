package cmd

import (
	"reflect"
	"testing"
)

func TestServerCommandDoesNotWatchFiles(t *testing.T) {
	got := serverCommand()
	want := []string{"bun", "--env-file=.env.development", "src/index.ts"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("server command got %#v want %#v", got, want)
	}
}

func TestReportProgressInvokesConfiguredProgress(t *testing.T) {
	var got []string
	reportProgress(environmentOptions{
		Progress: func(message string) {
			got = append(got, message)
		},
	}, "checking repo")

	want := []string{"checking repo"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("progress got %#v want %#v", got, want)
	}
}
