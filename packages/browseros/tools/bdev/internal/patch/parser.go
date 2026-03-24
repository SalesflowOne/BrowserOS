package patch

import (
	"bytes"
	"fmt"
	"strings"
)

var diffPrefix = []byte("diff --git ")

func ParseUnifiedDiff(raw []byte) (map[string]*FilePatch, error) {
	parts := splitChunks(raw)
	patches := map[string]*FilePatch{}
	for _, part := range parts {
		fp, err := parseChunk(part)
		if err != nil {
			return nil, err
		}
		if fp != nil {
			patches[fp.Path] = fp
		}
	}
	return patches, nil
}

func ParsePath(raw []byte) (string, error) {
	fp, err := parseChunk(raw)
	if err != nil {
		return "", err
	}
	if fp == nil {
		return "", fmt.Errorf("empty patch")
	}
	return fp.Path, nil
}

func splitChunks(raw []byte) [][]byte {
	lines := bytes.Split(raw, []byte("\n"))
	chunks := [][]byte{}
	current := [][]byte{}
	for _, line := range lines {
		if bytes.HasPrefix(line, diffPrefix) {
			if len(current) > 0 {
				chunks = append(chunks, bytes.Join(current, []byte("\n")))
			}
			current = [][]byte{line}
			continue
		}
		if len(current) > 0 {
			current = append(current, line)
		}
	}
	if len(current) > 0 {
		chunks = append(chunks, bytes.Join(current, []byte("\n")))
	}
	return chunks
}

func parseChunk(chunk []byte) (*FilePatch, error) {
	if len(bytes.TrimSpace(chunk)) == 0 {
		return nil, nil
	}
	lines := strings.Split(string(chunk), "\n")
	header := lines[0]
	if !strings.HasPrefix(header, "diff --git ") {
		return nil, fmt.Errorf("unexpected patch header")
	}
	parts := strings.SplitN(header, " b/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("cannot parse patch header")
	}
	fp := &FilePatch{
		Path:    parts[1],
		Op:      OpPatch,
		Content: chunk,
	}
	for _, line := range lines[1:] {
		if strings.HasPrefix(line, "@@") {
			break
		}
		if strings.HasPrefix(line, "deleted file mode") {
			fp.Op = OpDeleted
			break
		}
		if strings.HasPrefix(line, "rename to ") {
			fp.Path = strings.TrimPrefix(line, "rename to ")
		}
	}
	return fp, nil
}
