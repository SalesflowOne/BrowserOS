package feature

import (
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

type featureDoc struct {
	Version  string                  `yaml:"version,omitempty"`
	Features map[string]*featureItem `yaml:"features,omitempty"`
}

type featureItem struct {
	Description string   `yaml:"description,omitempty"`
	Files       []string `yaml:"files,omitempty"`
}

type TagFeatureOpts struct {
	BrowserOSRepo string
	FeatureName   string
	Paths         []string
}

func TagFeature(opts TagFeatureOpts) error {
	path := filepath.Join(opts.BrowserOSRepo, "build", "features.yaml")
	doc := featureDoc{
		Version:  "1.0",
		Features: map[string]*featureItem{},
	}
	if data, err := os.ReadFile(path); err == nil {
		if err := yaml.Unmarshal(data, &doc); err != nil {
			return err
		}
	}
	if doc.Features == nil {
		doc.Features = map[string]*featureItem{}
	}
	item, ok := doc.Features[opts.FeatureName]
	if !ok {
		item = &featureItem{Description: "feat: " + opts.FeatureName}
		doc.Features[opts.FeatureName] = item
	}
	existing := map[string]bool{}
	for _, value := range item.Files {
		existing[value] = true
	}
	for _, value := range opts.Paths {
		value = strings.TrimSpace(value)
		if value != "" {
			existing[value] = true
		}
	}
	item.Files = item.Files[:0]
	for value := range existing {
		item.Files = append(item.Files, value)
	}
	slices.Sort(item.Files)
	data, err := yaml.Marshal(&doc)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
