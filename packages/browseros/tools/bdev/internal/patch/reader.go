package patch

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"bdev/internal/git"
)

func ReadCurrentPatchSet(browserOSRepo string) (map[string]*FilePatch, error) {
	patchesDir := filepath.Join(browserOSRepo, "chromium_patches")
	patches := map[string]*FilePatch{}
	err := filepath.Walk(patchesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, err := filepath.Rel(patchesDir, path)
		if err != nil {
			return err
		}
		fp, err := readFile(path, rel)
		if err != nil {
			return err
		}
		patches[fp.Path] = fp
		return nil
	})
	if err != nil {
		return nil, err
	}
	return patches, nil
}

func ReadCurrentPatch(browserOSRepo, path string) (*FilePatch, bool, error) {
	patchesDir := filepath.Join(browserOSRepo, "chromium_patches")
	for _, rel := range []string{path + ".deleted", path} {
		full := filepath.Join(patchesDir, rel)
		if _, err := os.Stat(full); err == nil {
			fp, err := readFile(full, rel)
			return fp, true, err
		}
	}
	return nil, false, nil
}

func ReadPatchAtRevision(browserOSRepo, rev, path string) (*FilePatch, bool, error) {
	for _, rel := range []string{path + ".deleted", path} {
		content, ok, err := git.ShowFile(browserOSRepo, rev, filepath.ToSlash(filepath.Join("chromium_patches", rel)))
		if err != nil {
			return nil, false, err
		}
		if !ok {
			continue
		}
		fp := &FilePatch{Path: path, Op: OpPatch, Content: content}
		if strings.HasSuffix(rel, ".deleted") {
			fp.Op = OpDeleted
			fp.Content = nil
		}
		return fp, true, nil
	}
	return nil, false, nil
}

func ListPatchPaths(browserOSRepo string) ([]string, error) {
	patches, err := ReadCurrentPatchSet(browserOSRepo)
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(patches))
	for path := range patches {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}

func readFile(full, rel string) (*FilePatch, error) {
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	path := strings.TrimSuffix(rel, ".deleted")
	if strings.HasSuffix(rel, ".deleted") {
		return &FilePatch{Path: path, Op: OpDeleted}, nil
	}
	return &FilePatch{Path: path, Op: OpPatch, Content: data}, nil
}
