package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	DefaultCheckout string `yaml:"default_checkout,omitempty"`
	ColorMode       string `yaml:"color_mode,omitempty"`
	ProgressMode    string `yaml:"progress_mode,omitempty"`
}

func DefaultConfig() *Config {
	return &Config{
		ColorMode:    "auto",
		ProgressMode: "auto",
	}
}

func Load() (*Config, error) {
	if err := EnsureLayout(); err != nil {
		return nil, err
	}
	path, err := ConfigPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultConfig(), nil
		}
		return nil, err
	}
	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	if cfg.ColorMode == "" {
		cfg.ColorMode = "auto"
	}
	if cfg.ProgressMode == "" {
		cfg.ProgressMode = "auto"
	}
	return cfg, nil
}

func Save(cfg *Config) error {
	if err := EnsureLayout(); err != nil {
		return err
	}
	path, err := ConfigPath()
	if err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
