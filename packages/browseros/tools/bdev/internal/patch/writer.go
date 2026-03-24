package patch

import (
	"os"
	"path/filepath"
)

func Write(browserOSRepo string, fp *FilePatch) error {
	root := filepath.Join(browserOSRepo, "chromium_patches")
	if err := cleanup(root, fp.Path); err != nil {
		return err
	}
	if fp.Op == OpDeleted {
		target := filepath.Join(root, fp.Path+".deleted")
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, []byte("deleted: "+fp.Path+"\n"), 0o644)
	}
	target := filepath.Join(root, fp.Path)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, fp.Content, 0o644)
}

func Remove(browserOSRepo, path string) error {
	root := filepath.Join(browserOSRepo, "chromium_patches")
	return cleanup(root, path)
}

func cleanup(root, path string) error {
	for _, suffix := range []string{"", ".deleted", ".binary", ".rename"} {
		full := filepath.Join(root, path+suffix)
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
