package session

import "time"

type ConflictEntry struct {
	Path         string `yaml:"path"`
	Stage        string `yaml:"stage"`
	RejectPath   string `yaml:"reject_path,omitempty"`
	PatchContent string `yaml:"patch_content,omitempty"`
	Error        string `yaml:"error,omitempty"`
}

type Session struct {
	CheckoutID  string          `yaml:"checkout_id"`
	Kind        string          `yaml:"kind"`
	FromRepoRev string          `yaml:"from_repo_rev,omitempty"`
	ToRepoRev   string          `yaml:"to_repo_rev,omitempty"`
	Pending     []ConflictEntry `yaml:"pending"`
	Resolved    []string        `yaml:"resolved,omitempty"`
	CreatedAt   time.Time       `yaml:"created_at"`
	UpdatedAt   time.Time       `yaml:"updated_at"`
}
