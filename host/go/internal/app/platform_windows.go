//go:build windows

package app

import (
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"

	platform "github.com/u2bo/OpenChatGPTSkin/host/go/internal/platform/windows"
	"golang.org/x/sys/windows"
)

const windowsStillActive = 259

func controlEndpoint(dataRoot string) string              { return platform.Endpoint(dataRoot) }
func listenControl(endpoint string) (net.Listener, error) { return platform.Listen(endpoint) }
func dialControl(endpoint string) (net.Conn, error)       { return platform.Dial(endpoint) }

func configureDetached(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000008 | 0x00000200,
		HideWindow:    true,
	}
}

func processStartedAt(pid int) (string, error) {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	var code uint32
	if err := windows.GetExitCodeProcess(handle, &code); err != nil {
		return "", err
	}
	if code != windowsStillActive {
		return "", syscall.EINVAL
	}
	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return "", err
	}
	return strconv.FormatInt(creation.Nanoseconds(), 10), nil
}

func currentProcessIdentity() (int, string, error) {
	startedAt, err := processStartedAt(os.Getpid())
	return os.Getpid(), startedAt, err
}

func processAlive(pid int, startedAt string) bool {
	actual, err := processStartedAt(pid)
	return err == nil && actual == startedAt
}

func openBrowser(url string) error {
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
}

func defaultDataRoot() (string, error) {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		return "", os.ErrNotExist
	}
	return filepath.Join(root, "OpenChatGPTSkin"), nil
}
