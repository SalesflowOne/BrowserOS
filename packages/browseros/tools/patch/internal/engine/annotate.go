package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/git"
	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/patch"
	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/repo"
	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/workspace"
	"gopkg.in/yaml.v3"
)

type AnnotateOptions struct {
	Workspace workspace.Entry
	Repo      *repo.Info
	Feature   string
	Progress  Progress
}

type AnnotateResult struct {
	Workspace       string                     `json:"workspace"`
	FeaturesFile    string                     `json:"features_file"`
	Feature         string                     `json:"feature,omitempty"`
	Processed       int                        `json:"processed"`
	CommitsCreated  int                        `json:"commits_created"`
	FeaturesSkipped int                        `json:"features_skipped"`
	Committed       []AnnotateCommittedFeature `json:"committed"`
	Skipped         []AnnotateSkippedFeature   `json:"skipped"`
}

type AnnotateCommittedFeature struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Commit      string   `json:"commit"`
	Files       []string `json:"files"`
}

type AnnotateSkippedFeature struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Reason      string `json:"reason"`
}

type annotateFeature struct {
	Name        string
	Description string
	Files       []string
}

// Annotate creates Chromium checkout commits grouped by build/features.yaml.
func Annotate(ctx context.Context, opts AnnotateOptions) (*AnnotateResult, error) {
	featuresFile := filepath.Join(opts.Repo.Root, "build", "features.yaml")
	features, err := loadAnnotateFeatures(featuresFile)
	if err != nil {
		return nil, err
	}
	if opts.Feature != "" {
		filtered := slices.DeleteFunc(slices.Clone(features), func(feature annotateFeature) bool {
			return feature.Name != opts.Feature
		})
		if len(filtered) == 0 {
			return nil, fmt.Errorf("feature %q not found in features.yaml", opts.Feature)
		}
		features = filtered
	}
	result := &AnnotateResult{
		Workspace:    opts.Workspace.Name,
		FeaturesFile: featuresFile,
		Feature:      opts.Feature,
		Committed:    []AnnotateCommittedFeature{},
		Skipped:      []AnnotateSkippedFeature{},
	}
	for _, feature := range features {
		result.Processed++
		reportProgress(opts.Progress, "Annotating feature %s", feature.Name)
		if len(feature.Files) == 0 {
			result.Skipped = append(result.Skipped, AnnotateSkippedFeature{
				Name:        feature.Name,
				Description: feature.Description,
				Reason:      "no files",
			})
			result.FeaturesSkipped++
			continue
		}
		modified, err := modifiedFeatureFiles(ctx, opts.Workspace.Path, feature.Files)
		if err != nil {
			return nil, err
		}
		if len(modified) == 0 {
			result.Skipped = append(result.Skipped, AnnotateSkippedFeature{
				Name:        feature.Name,
				Description: feature.Description,
				Reason:      "no changes",
			})
			result.FeaturesSkipped++
			continue
		}
		commit, err := commitFeatureFiles(ctx, opts.Workspace.Path, feature.Description, feature.Files)
		if err != nil {
			return nil, fmt.Errorf("commit feature %s: %w", feature.Name, err)
		}
		result.Committed = append(result.Committed, AnnotateCommittedFeature{
			Name:        feature.Name,
			Description: feature.Description,
			Commit:      commit,
			Files:       modified,
		})
		result.CommitsCreated++
	}
	return result, nil
}

func loadAnnotateFeatures(featuresFile string) ([]annotateFeature, error) {
	body, err := os.ReadFile(featuresFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("features file not found: %s", featuresFile)
		}
		return nil, err
	}
	var root yaml.Node
	if err := yaml.Unmarshal(body, &root); err != nil {
		return nil, err
	}
	featuresNode := mappingValue(&root, "features")
	if featuresNode == nil || featuresNode.Kind != yaml.MappingNode || len(featuresNode.Content) == 0 {
		return nil, fmt.Errorf("no features found in %s", featuresFile)
	}
	features := make([]annotateFeature, 0, len(featuresNode.Content)/2)
	for idx := 0; idx+1 < len(featuresNode.Content); idx += 2 {
		name := featuresNode.Content[idx].Value
		data := featuresNode.Content[idx+1]
		description := scalarValue(data, "description")
		if description == "" {
			description = name
		}
		features = append(features, annotateFeature{
			Name:        name,
			Description: description,
			Files:       stringSequence(data, "files"),
		})
	}
	return features, nil
}

func mappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil {
		return nil
	}
	if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
		node = node.Content[0]
	}
	if node.Kind != yaml.MappingNode {
		return nil
	}
	for idx := 0; idx+1 < len(node.Content); idx += 2 {
		if node.Content[idx].Value == key {
			return node.Content[idx+1]
		}
	}
	return nil
}

func scalarValue(node *yaml.Node, key string) string {
	value := mappingValue(node, key)
	if value == nil || value.Kind != yaml.ScalarNode {
		return ""
	}
	return value.Value
}

func stringSequence(node *yaml.Node, key string) []string {
	value := mappingValue(node, key)
	if value == nil || value.Kind != yaml.SequenceNode {
		return nil
	}
	var items []string
	for _, item := range value.Content {
		if item.Kind != yaml.ScalarNode {
			continue
		}
		rel := patch.NormalizeChromiumPath(item.Value)
		if rel != "." && rel != "" {
			items = append(items, rel)
		}
	}
	return items
}

func modifiedFeatureFiles(ctx context.Context, workspacePath string, files []string) ([]string, error) {
	changes, err := git.StatusPorcelain(ctx, workspacePath, files)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var modified []string
	for _, change := range changes {
		for _, rel := range []string{change.Path, change.OldPath} {
			rel = patch.NormalizeChromiumPath(rel)
			if rel == "." || rel == "" || patch.IsInternalPath(rel) || seen[rel] {
				continue
			}
			seen[rel] = true
			modified = append(modified, rel)
		}
	}
	slices.Sort(modified)
	return modified, nil
}

func commitFeatureFiles(ctx context.Context, workspacePath string, message string, files []string) (string, error) {
	if err := git.AddAllPaths(ctx, workspacePath, files); err != nil {
		return "", err
	}
	return git.CommitPaths(ctx, workspacePath, message, files)
}
