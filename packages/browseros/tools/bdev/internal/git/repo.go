package git

import (
	"fmt"
	"strings"
)

func Root(dir string) (string, error) {
	return Run(dir, "rev-parse", "--show-toplevel")
}

func HeadRev(dir string) (string, error) {
	return Run(dir, "rev-parse", "HEAD")
}

func CommitExists(dir, ref string) bool {
	_, err := Run(dir, "cat-file", "-e", ref+"^{commit}")
	return err == nil
}

func IsDirty(dir string) (bool, error) {
	out, err := Run(dir, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) != "", nil
}

func FileExistsInCommit(dir, ref, path string) bool {
	_, err := Run(dir, "cat-file", "-e", ref+":"+path)
	return err == nil
}

func ShowFile(dir, ref, path string) ([]byte, bool, error) {
	out, err := RunBytes(dir, "show", fmt.Sprintf("%s:%s", ref, path))
	if err != nil {
		if strings.Contains(err.Error(), "exists on disk, but not in") || strings.Contains(err.Error(), "path") {
			return nil, false, nil
		}
		return nil, false, nil
	}
	return out, true, nil
}
