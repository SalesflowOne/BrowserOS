package cmd

import (
	"os"
	"path/filepath"

	"bdev/internal/git"
	"bdev/internal/patchrepo"
	"bdev/internal/registry"
)

func resolveCheckout(name string) (*registry.CheckoutRecord, error) {
	if name != "" {
		return reg.ResolveByName(name)
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	root, err := git.Root(cwd)
	if err != nil {
		return nil, fail("not inside a git checkout and --checkout not provided")
	}
	return reg.ResolveByRoot(root)
}

func loadPatchContext(record *registry.CheckoutRecord) (*patchrepo.Context, error) {
	return patchrepo.Load(record.BrowserOSRepo)
}

func looksLikeChromium(dir string) bool {
	markers := []string{"chrome", "base", ".git"}
	for _, marker := range markers {
		if _, err := os.Stat(filepath.Join(dir, marker)); err != nil {
			return false
		}
	}
	return true
}
