package engine

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"bdev/internal/git"
	"bdev/internal/patch"
)

func requireCleanPatchRepo(ctx *Context) error {
	dirty, err := git.IsDirty(ctx.PatchRepo.BrowserOSRepo)
	if err != nil {
		return err
	}
	if dirty {
		return fail("BrowserOS patch repo is dirty; commit or stash changes first")
	}
	return nil
}

func resetPathToBase(ctx *Context, path string) error {
	full := filepath.Join(ctx.Checkout.ChromiumRoot, path)
	if git.FileExistsInCommit(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit, path) {
		return git.CheckoutFiles(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit, []string{path})
	}
	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func resetAllToBase(ctx *Context) error {
	status, err := git.DiffNameStatus(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit)
	if err != nil {
		return err
	}
	paths := make([]string, 0, len(status))
	for path := range status {
		if git.FileExistsInCommit(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit, path) {
			paths = append(paths, path)
			continue
		}
		full := filepath.Join(ctx.Checkout.ChromiumRoot, path)
		if err := os.RemoveAll(full); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	slices.Sort(paths)
	return git.CheckoutFiles(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit, paths)
}

func intersect(a map[string]string, b []string) []string {
	seen := map[string]bool{}
	for _, value := range b {
		if _, ok := a[value]; ok {
			seen[value] = true
		}
	}
	out := make([]string, 0, len(seen))
	for value := range seen {
		out = append(out, value)
	}
	slices.Sort(out)
	return out
}

func materializeState(baseData []byte, baseExists bool, patchContent []byte, path string) ([]byte, bool, error) {
	dir, err := os.MkdirTemp("", "bdev-state-*")
	if err != nil {
		return nil, false, err
	}
	defer os.RemoveAll(dir)
	if _, err := git.Run(dir, "init", "-q"); err != nil {
		return nil, false, err
	}
	target := filepath.Join(dir, path)
	if baseExists {
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return nil, false, err
		}
		if err := os.WriteFile(target, baseData, 0o644); err != nil {
			return nil, false, err
		}
	}
	if len(patchContent) > 0 {
		if _, err := git.Apply(dir, patchContent); err != nil {
			return nil, false, err
		}
	}
	data, err := os.ReadFile(target)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return data, true, nil
}

func buildOverlayPatch(path string, from []byte, fromExists bool, to []byte, toExists bool) ([]byte, error) {
	dir, err := os.MkdirTemp("", "bdev-overlay-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	oldRoot := filepath.Join(dir, "old")
	newRoot := filepath.Join(dir, "new")
	oldFile := filepath.Join(oldRoot, path)
	newFile := filepath.Join(newRoot, path)
	if fromExists {
		if err := os.MkdirAll(filepath.Dir(oldFile), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(oldFile, from, 0o644); err != nil {
			return nil, err
		}
	}
	if toExists {
		if err := os.MkdirAll(filepath.Dir(newFile), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(newFile, to, 0o644); err != nil {
			return nil, err
		}
	}
	fromArg := oldFile
	if !fromExists {
		fromArg = "/dev/null"
	}
	toArg := newFile
	if !toExists {
		toArg = "/dev/null"
	}
	raw, err := git.DiffNoIndexUnified(fromArg, toArg, 0)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	lines := strings.Split(string(raw), "\n")
	for i, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			lines[i] = "diff --git a/" + path + " b/" + path
		case strings.HasPrefix(line, "--- "):
			if !strings.Contains(line, "/dev/null") {
				lines[i] = "--- a/" + path
			}
		case strings.HasPrefix(line, "+++ "):
			if !strings.Contains(line, "/dev/null") {
				lines[i] = "+++ b/" + path
			}
		}
	}
	return []byte(strings.Join(lines, "\n")), nil
}

func currentFile(ctx *Context, path string) ([]byte, bool, error) {
	full := filepath.Join(ctx.Checkout.ChromiumRoot, path)
	data, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return data, true, nil
}

func baseFile(ctx *Context, path string) ([]byte, bool, error) {
	return git.ShowFile(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit, path)
}

func oldPatch(ctx *Context, path string) (*patch.FilePatch, bool, error) {
	if ctx.Checkout.LastSyncedRev == "" {
		return nil, false, nil
	}
	return patch.ReadPatchAtRevision(ctx.PatchRepo.BrowserOSRepo, ctx.Checkout.LastSyncedRev, path)
}
