package patchrepo

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Context struct {
	BrowserOSRepo   string
	PatchesDir      string
	BaseCommit      string
	ChromiumVersion string
}

func Load(repo string) (*Context, error) {
	repo, err := filepath.Abs(repo)
	if err != nil {
		return nil, err
	}
	patchesDir := filepath.Join(repo, "chromium_patches")
	if _, err := os.Stat(patchesDir); err != nil {
		return nil, fmt.Errorf("chromium_patches/ not found in %s", repo)
	}
	baseCommit, err := readTrimmed(filepath.Join(repo, "BASE_COMMIT"))
	if err != nil {
		return nil, fmt.Errorf("reading BASE_COMMIT: %w", err)
	}
	version, err := readVersion(filepath.Join(repo, "CHROMIUM_VERSION"))
	if err != nil {
		return nil, err
	}
	return &Context{
		BrowserOSRepo:   repo,
		PatchesDir:      patchesDir,
		BaseCommit:      baseCommit,
		ChromiumVersion: version,
	}, nil
}

func readTrimmed(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func readVersion(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	vars := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		vars[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}
	if vars["MAJOR"] == "" {
		return "", nil
	}
	return fmt.Sprintf("%s.%s.%s.%s", vars["MAJOR"], vars["MINOR"], vars["BUILD"], vars["PATCH"]), nil
}
