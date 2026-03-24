package session

import (
	"errors"
	"os"
	"path/filepath"
	"time"

	"bdev/internal/config"

	"gopkg.in/yaml.v3"
)

func Load(checkoutID string) (*Session, error) {
	path, err := sessionPath(checkoutID)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errors.New("no active session")
		}
		return nil, err
	}
	var s Session
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func Save(s *Session) error {
	if err := config.EnsureLayout(); err != nil {
		return err
	}
	s.UpdatedAt = time.Now()
	if s.CreatedAt.IsZero() {
		s.CreatedAt = s.UpdatedAt
	}
	path, err := sessionPath(s.CheckoutID)
	if err != nil {
		return err
	}
	data, err := yaml.Marshal(s)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func Delete(checkoutID string) error {
	path, err := sessionPath(checkoutID)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func sessionPath(checkoutID string) (string, error) {
	dir, err := config.SessionsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, checkoutID+".yaml"), nil
}
