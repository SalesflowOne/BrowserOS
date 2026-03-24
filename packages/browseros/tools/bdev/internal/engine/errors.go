package engine

import "fmt"

func fail(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}
