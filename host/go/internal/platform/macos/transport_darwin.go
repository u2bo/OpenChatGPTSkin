//go:build darwin

package macos

import (
	"errors"
	"net"
	"os"
	"syscall"
)

type ownedListener struct {
	net.Listener
	path string
	dev  uint64
	ino  uint64
}

func Listen(endpoint string) (net.Listener, error) {
	if err := removeStaleSocket(endpoint); err != nil {
		return nil, err
	}
	listener, err := net.Listen("unix", endpoint)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(endpoint, 0o600); err != nil {
		listener.Close()
		os.Remove(endpoint)
		return nil, err
	}
	info, err := os.Stat(endpoint)
	if err != nil {
		listener.Close()
		os.Remove(endpoint)
		return nil, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Getuid() {
		listener.Close()
		os.Remove(endpoint)
		return nil, errors.New("unix socket ownership is invalid")
	}
	return &ownedListener{Listener: listener, path: endpoint, dev: uint64(stat.Dev), ino: stat.Ino}, nil
}

func removeStaleSocket(endpoint string) error {
	info, err := os.Lstat(endpoint)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSocket == 0 || int(stat.Uid) != os.Getuid() {
		return errors.New("existing unix socket path is not an owned socket")
	}
	return os.Remove(endpoint)
}

func (listener *ownedListener) Close() error {
	closeErr := listener.Listener.Close()
	info, statErr := os.Lstat(listener.path)
	if statErr == nil {
		if stat, ok := info.Sys().(*syscall.Stat_t); ok && uint64(stat.Dev) == listener.dev && stat.Ino == listener.ino {
			if removeErr := os.Remove(listener.path); removeErr != nil && closeErr == nil {
				closeErr = removeErr
			}
		}
	} else if !errors.Is(statErr, os.ErrNotExist) && closeErr == nil {
		closeErr = statErr
	}
	return closeErr
}

func Dial(endpoint string) (net.Conn, error) {
	return net.Dial("unix", endpoint)
}
