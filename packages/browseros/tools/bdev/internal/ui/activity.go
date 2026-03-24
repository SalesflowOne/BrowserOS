package ui

import (
	"fmt"
	"os"
	"sync"
	"time"

	"golang.org/x/term"
)

type Activity struct {
	enabled bool
	spinner *spinner
}

func NewActivity(enabled bool) *Activity {
	return &Activity{
		enabled: enabled && term.IsTerminal(int(os.Stderr.Fd())),
	}
}

func (a *Activity) Start(format string, args ...any) func(ok bool, detail string) {
	label := fmt.Sprintf(format, args...)
	if a.enabled {
		a.spinner = newSpinner(label)
		a.spinner.start()
	} else {
		fmt.Fprintf(os.Stderr, "  • %s\n", label)
	}
	start := time.Now()
	return func(ok bool, detail string) {
		if a.spinner != nil {
			a.spinner.stop(ok, detail, time.Since(start))
			a.spinner = nil
			return
		}
		status := Success("done")
		if !ok {
			status = Warn("warn")
		}
		if detail != "" {
			fmt.Fprintf(os.Stderr, "    %s %s (%s)\n", status, detail, time.Since(start).Round(time.Millisecond))
			return
		}
		fmt.Fprintf(os.Stderr, "    %s (%s)\n", status, time.Since(start).Round(time.Millisecond))
	}
}

type spinner struct {
	label  string
	stopCh chan struct{}
	wg     sync.WaitGroup
}

func newSpinner(label string) *spinner {
	return &spinner{
		label:  label,
		stopCh: make(chan struct{}),
	}
}

func (s *spinner) start() {
	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		i := 0
		ticker := time.NewTicker(90 * time.Millisecond)
		defer ticker.Stop()
		for {
			fmt.Fprintf(os.Stderr, "\r  %s %s", frames[i%len(frames)], s.label)
			i++
			select {
			case <-ticker.C:
			case <-s.stopCh:
				return
			}
		}
	}()
}

func (s *spinner) stop(ok bool, detail string, elapsed time.Duration) {
	close(s.stopCh)
	s.wg.Wait()
	symbol := Success("✓")
	if !ok {
		symbol = Warn("!")
	}
	fmt.Fprint(os.Stderr, "\r")
	if detail != "" {
		fmt.Fprintf(os.Stderr, "  %s %s %s (%s)\n", symbol, s.label, Muted(detail), elapsed.Round(time.Millisecond))
		return
	}
	fmt.Fprintf(os.Stderr, "  %s %s (%s)\n", symbol, s.label, elapsed.Round(time.Millisecond))
}
