package proc

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// StopExistingWatchProcesses terminates older default-profile watch supervisors.
// Port cleanup cannot see a previous watch process while it is still waiting
// for CDP, but that process will wake up later and race the new supervisor.
func StopExistingWatchProcesses(timeout time.Duration) (int, error) {
	currentPGID, err := syscall.Getpgid(0)
	if err != nil {
		return 0, fmt.Errorf("reading current process group: %w", err)
	}

	groups, err := currentWatchProcessGroups(currentPGID)
	if err != nil {
		return 0, err
	}
	if len(groups) == 0 {
		return 0, nil
	}

	for _, pgid := range groups {
		if err := signalProcessGroup(pgid, syscall.SIGTERM); err != nil {
			return 0, err
		}
	}

	deadline := time.Now().Add(timeout)
	for {
		remaining, err := currentWatchProcessGroups(currentPGID)
		if err != nil {
			return 0, err
		}
		if len(remaining) == 0 {
			return len(groups), nil
		}
		if time.Now().After(deadline) {
			for _, pgid := range remaining {
				if err := signalProcessGroup(pgid, syscall.SIGKILL); err != nil {
					return 0, err
				}
			}
			return len(groups), nil
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func currentWatchProcessGroups(currentPGID int) ([]int, error) {
	output, err := exec.Command("ps", "-axo", "pid=,pgid=,command=").Output()
	if err != nil {
		return nil, fmt.Errorf("listing processes: %w", err)
	}
	return watchProcessGroupsFromPS(string(output), currentPGID), nil
}

func watchProcessGroupsFromPS(output string, currentPGID int) []int {
	seen := map[int]struct{}{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pgid, err := strconv.Atoi(fields[1])
		if err != nil || pgid == currentPGID {
			continue
		}
		if isDefaultWatchCommand(fields[2:]) {
			seen[pgid] = struct{}{}
		}
	}

	groups := make([]int, 0, len(seen))
	for pgid := range seen {
		groups = append(groups, pgid)
	}
	sort.Ints(groups)
	return groups
}

func isDefaultWatchCommand(commandFields []string) bool {
	if len(commandFields) < 2 {
		return false
	}
	if filepath.Base(commandFields[0]) != "browseros-dev" {
		return false
	}
	if commandFields[1] != "watch" {
		return false
	}
	for _, field := range commandFields[2:] {
		if field == "--new" {
			return false
		}
	}
	return true
}

func signalProcessGroup(pgid int, signal syscall.Signal) error {
	if pgid <= 0 {
		return nil
	}
	if err := syscall.Kill(-pgid, signal); err != nil && err != syscall.ESRCH {
		return fmt.Errorf("signaling process group %d: %w", pgid, err)
	}
	return nil
}
