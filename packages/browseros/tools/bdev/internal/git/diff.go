package git

import (
	"fmt"
	"sort"
	"strings"
)

func DiffNameStatus(dir, base string) (map[string]string, error) {
	out, err := Run(dir, "diff", "--name-status", "-M", base)
	if err != nil {
		return nil, err
	}
	result := map[string]string{}
	parseNameStatus(result, out)
	untracked, err := Run(dir, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(untracked, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			result[line] = "A"
		}
	}
	return result, nil
}

func DiffFile(dir, base, path string) ([]byte, error) {
	return RunBytes(dir, "diff", "--full-index", "-M", base, "--", path)
}

func DiffFiles(dir, base string, paths []string) ([]byte, error) {
	args := []string{"diff", "--full-index", "-M", base, "--"}
	args = append(args, paths...)
	return RunBytes(dir, args...)
}

func DiffNoIndex(oldPath, newPath string) ([]byte, error) {
	return RunExitCodeOneOK("", "diff", "--no-index", "--full-index", oldPath, newPath)
}

func DiffNoIndexUnified(oldPath, newPath string, unified int) ([]byte, error) {
	return RunExitCodeOneOK("", "diff", "--no-index", "--full-index", fmt.Sprintf("--unified=%d", unified), oldPath, newPath)
}

func DiffChangedPathsBetween(dir, fromRev, toRev string) ([]string, error) {
	out, err := Run(dir, "diff", "--name-status", "--find-renames", fmt.Sprintf("%s..%s", fromRev, toRev), "--", "chromium_patches")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		for _, field := range fields[1:] {
			field = strings.TrimSpace(field)
			if strings.HasPrefix(field, "chromium_patches/") {
				field = strings.TrimPrefix(field, "chromium_patches/")
			}
			field = strings.TrimSuffix(field, ".deleted")
			field = strings.TrimSuffix(field, ".binary")
			field = strings.TrimSuffix(field, ".rename")
			if field != "" {
				seen[field] = true
			}
		}
	}
	paths := make([]string, 0, len(seen))
	for path := range seen {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}

func parseNameStatus(result map[string]string, out string) {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		status := string(fields[0][0])
		path := fields[len(fields)-1]
		result[path] = status
	}
}
