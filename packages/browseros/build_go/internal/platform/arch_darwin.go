//go:build darwin

package platform

import "golang.org/x/sys/unix"

// nativeArch reports the machine's real CPU architecture, like Python's
// platform.machine(). hw.optional.arm64 is 1 on Apple Silicon even when the
// process runs under Rosetta (where GOARCH would claim amd64).
func nativeArch() string {
	if v, err := unix.SysctlUint32("hw.optional.arm64"); err == nil && v == 1 {
		return "arm64"
	}
	return ""
}
