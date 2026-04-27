package browser

import (
	"fmt"
	"path/filepath"

	"browseros-alpha/config"
)

type ArgsConfig struct {
	Binary      string
	AgentRoot   string
	UserDataDir string
	Ports       config.Ports
	Headless    bool
}

func BuildArgs(cfg ArgsConfig) []string {
	args := []string{
		cfg.Binary,
		"--no-first-run",
		"--no-default-browser-check",
		"--show-component-extension-options",
		"--disable-browseros-server",
		"--disable-browseros-extensions",
		fmt.Sprintf("--remote-debugging-port=%d", cfg.Ports.CDP),
		fmt.Sprintf("--browseros-mcp-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-server-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-proxy-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-extension-port=%d", cfg.Ports.Extension),
		fmt.Sprintf("--user-data-dir=%s", cfg.UserDataDir),
		fmt.Sprintf("--load-extension=%s", filepath.Join(cfg.AgentRoot, "apps/agent/dist/chrome-mv3-dev")),
	}
	if cfg.Headless {
		args = append(args, "--headless=new")
	}
	return append(args, "chrome://newtab")
}
