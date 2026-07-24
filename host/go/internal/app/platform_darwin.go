//go:build darwin

package app

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	platform "github.com/u2bo/OpenChatGPTSkin/host/go/internal/platform/macos"
	"golang.org/x/sys/unix"
)

func controlEndpoint(dataRoot string) string              { return filepath.Join(dataRoot, "runtime.sock") }
func listenControl(endpoint string) (net.Listener, error) { return platform.Listen(endpoint) }
func dialControl(endpoint string) (net.Conn, error)       { return platform.Dial(endpoint) }
func configureDetached(command *exec.Cmd)                 { command.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }

func processStartedAt(pid int) (string, error) {
	process, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return "", err
	}
	if process.Proc.P_pid != int32(pid) {
		return "", syscall.ESRCH
	}
	started := process.Proc.P_starttime
	return fmt.Sprintf("%d:%06d", started.Sec, started.Usec), nil
}

func currentProcessIdentity() (int, string, error) {
	startedAt, err := processStartedAt(os.Getpid())
	return os.Getpid(), startedAt, err
}

func processAlive(pid int, startedAt string) bool {
	if syscall.Kill(pid, 0) != nil {
		return false
	}
	actual, err := processStartedAt(pid)
	return err == nil && actual == startedAt
}
