package config

import (
	"os"
	"path/filepath"
)

func RootDir() (string, error) {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "bdev"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "bdev"), nil
}

func ConfigPath() (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "config.yaml"), nil
}

func RegistryPath() (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "checkouts.yaml"), nil
}

func SessionsDir() (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "sessions"), nil
}

func LogsDir() (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "logs"), nil
}

func EnsureLayout() error {
	root, err := RootDir()
	if err != nil {
		return err
	}
	dirs := []string{root}
	if sessions, err := SessionsDir(); err == nil {
		dirs = append(dirs, sessions)
	}
	if logs, err := LogsDir(); err == nil {
		dirs = append(dirs, logs)
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return nil
}
