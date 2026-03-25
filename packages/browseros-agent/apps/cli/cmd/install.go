package cmd

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"browseros-cli/output"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:         "install",
		Annotations: map[string]string{"group": "Setup:"},
		Short:       "Download and install BrowserOS for the current platform",
		Args:        cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			dir, _ := cmd.Flags().GetString("dir")
			deb, _ := cmd.Flags().GetBool("deb")

			if deb && runtime.GOOS != "linux" {
				output.Error("--deb is only available on Linux", 1)
			}

			downloadURL, filename := resolveDownload(deb)

			destPath := filepath.Join(dir, filename)

			bold := color.New(color.Bold)
			green := color.New(color.FgGreen)
			dim := color.New(color.Faint)

			platformName := platformDisplayName()
			bold.Printf("Downloading BrowserOS for %s...\n", platformName)
			fmt.Printf("URL: %s\n", downloadURL)
			fmt.Printf("Destination: %s\n", destPath)
			fmt.Println()

			resp, err := http.Get(downloadURL)
			if err != nil {
				output.Errorf(1, "download failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				output.Errorf(1, "download failed: HTTP %d", resp.StatusCode)
			}

			file, err := os.Create(destPath)
			if err != nil {
				output.Errorf(1, "create file: %v", err)
			}
			defer file.Close()

			written, err := io.Copy(file, resp.Body)
			if err != nil {
				os.Remove(destPath)
				output.Errorf(1, "download interrupted: %v", err)
			}

			green.Printf("Downloaded %s (%.1f MB)\n", filename, float64(written)/(1024*1024))
			fmt.Println()

			runPostInstall(destPath, deb, dim)

			fmt.Println()
			dim.Println("After installing, launch BrowserOS and run: browseros-cli health")
		},
	}

	cmd.Flags().String("dir", ".", "Directory to download the installer to")
	cmd.Flags().Bool("deb", false, "Download .deb package instead of AppImage (Linux only)")

	rootCmd.AddCommand(cmd)
}

func resolveDownload(deb bool) (url, filename string) {
	switch runtime.GOOS {
	case "darwin":
		return "https://files.browseros.com/download/BrowserOS.dmg", "BrowserOS.dmg"
	case "windows":
		return "https://files.browseros.com/download/BrowserOS_installer.exe", "BrowserOS_installer.exe"
	case "linux":
		if deb {
			return "https://cdn.browseros.com/download/BrowserOS.deb", "BrowserOS.deb"
		}
		return "https://files.browseros.com/download/BrowserOS.AppImage", "BrowserOS.AppImage"
	default:
		output.Errorf(1, "unsupported platform: %s", runtime.GOOS)
		return "", ""
	}
}

func platformDisplayName() string {
	switch runtime.GOOS {
	case "darwin":
		return "macOS"
	case "windows":
		return "Windows"
	case "linux":
		return "Linux"
	default:
		return runtime.GOOS
	}
}

func runPostInstall(path string, deb bool, dim *color.Color) {
	switch runtime.GOOS {
	case "darwin":
		fmt.Println("Mounting disk image...")
		if err := exec.Command("open", path).Run(); err != nil {
			output.Errorf(1, "failed to mount DMG: %v", err)
		}
		dim.Println("DMG mounted. Drag BrowserOS to Applications to complete installation.")

	case "linux":
		if deb {
			dim.Println("To install the .deb package, run:")
			fmt.Printf("  sudo dpkg -i %s\n", path)
		} else {
			if err := os.Chmod(path, 0755); err != nil {
				output.Errorf(1, "chmod failed: %v", err)
			}
			dim.Printf("AppImage is ready. Run it with: ./%s\n", filepath.Base(path))
		}

	case "windows":
		fmt.Println("Launching installer...")
		if err := exec.Command("cmd", "/c", "start", "", path).Run(); err != nil {
			output.Errorf(1, "failed to launch installer: %v", err)
		}
		dim.Println("Installer launched. Follow the prompts to complete installation.")
	}
}
