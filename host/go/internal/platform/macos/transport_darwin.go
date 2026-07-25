//go:build darwin

package macos

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"syscall"
)

const socketDirectoryPrefix = "ocskin-"

type ownedListener struct {
	net.Listener
	path string
	dev  uint64
	ino  uint64
}

// Endpoint maps a data root to a short, user-private socket path. macOS Unix
// sockets have a small fixed path limit, while Application Support and test
// directories can be substantially longer than that limit.
func Endpoint(dataRoot string) string {
	digest := sha256.Sum256([]byte(filepath.Clean(dataRoot)))
	directory := filepath.Join("/tmp", fmt.Sprintf("%s%d", socketDirectoryPrefix, os.Getuid()))
	return filepath.Join(directory, hex.EncodeToString(digest[:8])+".sock")
}

func Listen(endpoint string) (net.Listener, error) {
	if err := ensurePrivateDirectory(filepath.Dir(endpoint)); err != nil {
		return nil, err
	}
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

func ensurePrivateDirectory(directory string) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || int(stat.Uid) != os.Getuid() || info.Mode().Perm()&0o077 != 0 {
		return errors.New("unix socket parent directory is not private")
	}
	return nil
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
