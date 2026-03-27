package update

import (
	"bytes"
	"crypto"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/minio/selfupdate"
)

func CheckPermissions(targetPath string) error {
	options := selfupdate.Options{TargetPath: targetPath}
	return options.CheckPermissions()
}

func ApplyBinary(binary []byte, checksumHex string, targetPath string) error {
	checksum, err := decodeChecksum(checksumHex)
	if err != nil {
		return err
	}

	options := selfupdate.Options{
		TargetPath: targetPath,
		Checksum:   checksum,
		Hash:       crypto.SHA256,
	}
	err = selfupdate.Apply(bytes.NewReader(binary), options)
	if rollbackErr := selfupdate.RollbackError(err); rollbackErr != nil {
		return fmt.Errorf("update failed and rollback failed: %w", rollbackErr)
	}

	return err
}

func decodeChecksum(checksumHex string) ([]byte, error) {
	value := strings.TrimSpace(checksumHex)
	if value == "" {
		return nil, fmt.Errorf("missing checksum")
	}
	return hex.DecodeString(value)
}
