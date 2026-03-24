package registry

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"bdev/internal/config"

	"gopkg.in/yaml.v3"
)

type CheckoutRecord struct {
	ID            string    `yaml:"id"`
	Name          string    `yaml:"name"`
	ChromiumRoot  string    `yaml:"chromium_root"`
	BrowserOSRepo string    `yaml:"browseros_repo"`
	BaseCommit    string    `yaml:"base_commit"`
	LastSyncedRev string    `yaml:"last_synced_rev,omitempty"`
	LastOp        string    `yaml:"last_op,omitempty"`
	UpdatedAt     time.Time `yaml:"updated_at"`
}

type Registry struct {
	Checkouts []CheckoutRecord `yaml:"checkouts"`
}

func Load() (*Registry, error) {
	if err := config.EnsureLayout(); err != nil {
		return nil, err
	}
	path, err := config.RegistryPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Registry{}, nil
		}
		return nil, err
	}
	var reg Registry
	if err := yaml.Unmarshal(data, &reg); err != nil {
		return nil, err
	}
	return &reg, nil
}

func Save(reg *Registry) error {
	if err := config.EnsureLayout(); err != nil {
		return err
	}
	path, err := config.RegistryPath()
	if err != nil {
		return err
	}
	data, err := yaml.Marshal(reg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (r *Registry) Upsert(record CheckoutRecord) CheckoutRecord {
	record.ChromiumRoot = filepath.Clean(record.ChromiumRoot)
	record.BrowserOSRepo = filepath.Clean(record.BrowserOSRepo)
	record.UpdatedAt = time.Now()
	if record.ID == "" {
		record.ID = newID(record.Name, record.ChromiumRoot)
	}
	for i := range r.Checkouts {
		if r.Checkouts[i].ChromiumRoot == record.ChromiumRoot || r.Checkouts[i].ID == record.ID {
			r.Checkouts[i] = record
			slices.SortFunc(r.Checkouts, compare)
			return record
		}
	}
	r.Checkouts = append(r.Checkouts, record)
	slices.SortFunc(r.Checkouts, compare)
	return record
}

func (r *Registry) ResolveByName(name string) (*CheckoutRecord, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("empty checkout name")
	}
	for i := range r.Checkouts {
		if r.Checkouts[i].Name == name || r.Checkouts[i].ID == name {
			return &r.Checkouts[i], nil
		}
	}
	return nil, errors.New("checkout not found")
}

func (r *Registry) ResolveByRoot(root string) (*CheckoutRecord, error) {
	root = filepath.Clean(root)
	for i := range r.Checkouts {
		if r.Checkouts[i].ChromiumRoot == root {
			return &r.Checkouts[i], nil
		}
	}
	return nil, errors.New("checkout not registered")
}

func (r *Registry) RemoveByID(id string) bool {
	for i := range r.Checkouts {
		if r.Checkouts[i].ID == id {
			r.Checkouts = append(r.Checkouts[:i], r.Checkouts[i+1:]...)
			return true
		}
	}
	return false
}

func newID(name, root string) string {
	h := sha1.Sum([]byte(filepath.Clean(root)))
	suffix := hex.EncodeToString(h[:])[:8]
	base := slug(name)
	if base == "" {
		base = "checkout"
	}
	return base + "-" + suffix
}

func slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, " ", "-")
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		isAlphaNum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if isAlphaNum {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteRune('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func compare(a, b CheckoutRecord) int {
	return strings.Compare(a.Name, b.Name)
}
