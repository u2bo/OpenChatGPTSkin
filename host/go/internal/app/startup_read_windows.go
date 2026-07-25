//go:build windows

package app

import (
	"errors"
	"syscall"
)

const windowsSharingViolation syscall.Errno = 32 // ERROR_SHARING_VIOLATION

// transientStartupReadError covers the short interval where Windows prevents
// a second process from reading a just-replaced handshake file. The caller
// remains bounded by its startup deadline and does not ignore other I/O errors.
func transientStartupReadError(err error) bool {
	return errors.Is(err, windowsSharingViolation)
}
