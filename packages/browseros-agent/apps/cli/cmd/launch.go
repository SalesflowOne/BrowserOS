package cmd

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"browseros-cli/output"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:   "launch",
		Short: "Launch the BrowserOS application",
		Long: `Find and launch the BrowserOS application.

Searches common install locations for your platform, launches the app,
and waits for the server to become ready.

If BrowserOS is already running, reports the server URL.`,
		Annotations: map[string]string{"group": "Setup:"},
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			green := color.New(color.FgGreen)
			dim := color.New(color.Faint)
			waitSecs, _ := cmd.Flags().GetInt("wait")

			// Check if already running
			if url := probeRunningServer(); url != "" {
				green.Printf("BrowserOS is already running at %s\n", url)
				return
			}

			// Find the application
			appPath := findBrowserOS()
			if appPath == "" {
				output.Error("BrowserOS is not installed.\n\n"+
					"  To install:  browseros-cli install", 1)
			}

			fmt.Printf("Launching %s...\n", filepath.Base(appPath))
			if err := startBrowserOS(appPath); err != nil {
				output.Errorf(1, "failed to launch: %v", err)
			}

			fmt.Print("Waiting for server")
			url, ok := waitForServer(time.Duration(waitSecs) * time.Second)
			fmt.Println()

			if !ok {
				output.Error("BrowserOS launched but server didn't respond within "+
					fmt.Sprintf("%d seconds.\n", waitSecs)+
					"  Check if BrowserOS is fully loaded, then retry.", 1)
			}

			green.Printf("BrowserOS is ready at %s\n", url)
			fmt.Println()
			dim.Println("Next: browseros-cli init --auto")
		},
	}

	cmd.Flags().Int("wait", 30, "Seconds to wait for server to start")
	rootCmd.AddCommand(cmd)
}

// probeRunningServer checks server.json and common ports for a running server.
func probeRunningServer() string {
	// Check server.json first (most reliable)
	if url := loadBrowserosServerURL(); url != "" {
		if isHealthy(url) {
			return url
		}
	}

	// Check saved config
	if url := defaultServerURL(); url != "" {
		if isHealthy(url) {
			return url
		}
	}

	// Probe common ports
	for _, port := range []int{9100, 9200, 9300} {
		url := fmt.Sprintf("http://127.0.0.1:%d", port)
		if isHealthy(url) {
			return url
		}
	}

	return ""
}

// isHealthy checks if a server URL responds with HTTP 200 on /health.
func isHealthy(baseURL string) bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(baseURL + "/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

// findBrowserOS returns the path to the BrowserOS application, or empty if not installed.
func findBrowserOS() string {
	switch runtime.GOOS {
	case "darwin":
		for _, name := range []string{"BrowserOS.app", "BrowserOS copy.app"} {
			p := filepath.Join("/Applications", name)
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				return p
			}
		}
		if home, err := os.UserHomeDir(); err == nil {
			p := filepath.Join(home, "Applications", "BrowserOS.app")
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				return p
			}
		}

	case "linux":
		if p, err := exec.LookPath("browseros"); err == nil {
			return p
		}
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

// startBrowserOS starts the BrowserOS application.
func startBrowserOS(appPath string) error {
	switch runtime.GOOS {
	case "darwin":
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

// waitForServer polls until a server responds or timeout.
func waitForServer(maxWait time.Duration) (string, bool) {
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(maxWait)

	for time.Now().Before(deadline) {
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
