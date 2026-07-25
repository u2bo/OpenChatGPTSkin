//go:build !windows

package app

func transientStartupReadError(error) bool { return false }
