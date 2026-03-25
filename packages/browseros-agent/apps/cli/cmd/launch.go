package cmd

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// findBrowserOS returns the path to the BrowserOS application, or empty if not installed.
func findBrowserOS() string {
	switch runtime.GOOS {
	case "darwin":
		// Check common macOS locations
		for _, name := range []string{"BrowserOS.app", "BrowserOS copy.app"} {
			p := filepath.Join("/Applications", name)
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				return p
			}
		}
		// Check user Applications
		if home, err := os.UserHomeDir(); err == nil {
			p := filepath.Join(home, "Applications", "BrowserOS.app")
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				return p
			}
		}

	case "linux":
		// Check if browseros binary is in PATH
		if p, err := exec.LookPath("browseros"); err == nil {
			return p
		}
		// Check for AppImage in common locations
		if home, err := os.UserHomeDir(); err == nil {
			for _, dir := range []string{home, filepath.Join(home, "Applications"), filepath.Join(home, "Downloads")} {
				entries, err := os.ReadDir(dir)
				if err != nil {
					continue
				}
				for _, e := range entries {
					if matched, _ := filepath.Match("BrowserOS*.AppImage", e.Name()); matched {
						return filepath.Join(dir, e.Name())
					}
				}
			}
		}

	case "windows":
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			p := filepath.Join(localAppData, "BrowserOS", "BrowserOS.exe")
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}

	return ""
}

// launchBrowserOS starts the BrowserOS application and returns nil on success.
func launchBrowserOS(appPath string) error {
	switch runtime.GOOS {
	case "darwin":
		// Use open(1) which handles .app bundles properly
		return exec.Command("open", appPath).Run()
	case "linux":
		cmd := exec.Command(appPath)
		cmd.Stdout = nil
		cmd.Stderr = nil
		return cmd.Start()
	case "windows":
		return exec.Command("cmd", "/c", "start", "", appPath).Run()
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

// waitForServer polls the health endpoint until the server responds or timeout.
func waitForServer(maxWait time.Duration) (string, bool) {
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(maxWait)

	for time.Now().Before(deadline) {
		// Check server.json first (gets written on startup with the actual port)
		if url := loadBrowserosServerURL(); url != "" {
			resp, err := client.Get(url + "/health")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					return url, true
				}
			}
		}
		fmt.Print(".")
		time.Sleep(1 * time.Second)
	}
	return "", false
}

// ensureRunning checks if BrowserOS is reachable. If not, it tries to launch it.
// Returns the server URL if successful, or an error message.
func ensureRunning(currentURL string) (string, error) {
	// First, check if the current URL is already reachable
	if currentURL != "" {
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get(currentURL + "/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return currentURL, nil
			}
		}
	}

	// Not reachable — try to find and launch BrowserOS
	appPath := findBrowserOS()
	if appPath == "" {
		return "", fmt.Errorf(
			"BrowserOS is not installed.\n\n" +
				"  To install:  browseros-cli install")
	}

	fmt.Printf("Launching BrowserOS (%s)...\n", filepath.Base(appPath))
	if err := launchBrowserOS(appPath); err != nil {
		return "", fmt.Errorf("failed to launch BrowserOS: %w", err)
	}

	fmt.Print("Waiting for server")
	url, ok := waitForServer(30 * time.Second)
	fmt.Println()

	if !ok {
		return "", fmt.Errorf(
			"BrowserOS launched but server didn't respond within 30 seconds.\n" +
				"  Check if BrowserOS is fully loaded, then retry.")
	}

	return url, nil
}
