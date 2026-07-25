//go:build darwin

// Package macos verifies a signed official Codex bundle before Runtime can
// launch it. It owns process/port identity only, never theme DOM logic.
package macos

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	expectedBundleID       = "com.openai.codex"
	expectedIdentity       = "OpenAI.Codex"
	expectedTeamID         = "2DC432GLL2"
	expectedEntryPoint     = "macOS.Application"
	expectedNotarization   = "Notarized Developer ID"
	expectedResourceSigner = "OpenAI, L.L.C."
	managedCDPReadyTimeout = 90 * time.Second
)

var (
	versionPattern   = regexp.MustCompile(`^\d+(?:\.\d+){0,3}$`)
	teamPattern      = regexp.MustCompile(`(?m)^TeamIdentifier=(.+)$`)
	authorityPattern = regexp.MustCompile(`(?m)^Authority=Developer ID Application:\s*(.+?)\s*\([A-Z0-9]+\)\s*$`)
)

type Install struct {
	PackageRoot       string
	EntryPath         string
	PackageVersion    string
	EntryRelativePath string
}

type ProcessIdentity struct {
	PID            int
	ParentPID      int
	StartedAt      string
	ExecutablePath string
}

type ManagedLaunch struct {
	Install Install
	Root    ProcessIdentity
	Port    int
}

type Error struct {
	Code    string
	Message string
}

func (err Error) Error() string { return err.Message }

func InspectOfficialCodex(ctx context.Context) (Install, error) {
	roots, err := candidateBundleRoots()
	if err != nil {
		return Install{}, err
	}
	if len(roots) == 0 {
		return Install{}, Error{Code: "CODEX_NOT_INSTALLED", Message: "Codex.app was not found in system or user Applications"}
	}
	if len(roots) != 1 {
		return Install{}, Error{Code: "CODEX_IDENTITY_INVALID", Message: "More than one Codex.app bundle is installed"}
	}
	return inspectInstall(ctx, roots[0])
}

func candidateBundleRoots() ([]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Current macOS user home is unavailable"}
	}
	candidates := []string{"/Applications/Codex.app", filepath.Join(home, "Applications", "Codex.app")}
	roots := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		info, statErr := os.Lstat(candidate)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil {
			return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: statErr.Error()}
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex.app must be a regular application bundle"}
		}
		absolute, absErr := filepath.Abs(candidate)
		if absErr != nil {
			return nil, absErr
		}
		roots = append(roots, absolute)
	}
	return roots, nil
}

func inspectInstall(ctx context.Context, root string) (Install, error) {
	read := func(key string) (string, error) {
		return runValue(ctx, "/usr/bin/plutil", "-extract", key, "raw", "-o", "-", filepath.Join(root, "Contents", "Info.plist"))
	}
	bundleID, err := read("CFBundleIdentifier")
	if err != nil {
		return Install{}, err
	}
	executable, err := read("CFBundleExecutable")
	if err != nil {
		return Install{}, err
	}
	version, err := read("CFBundleVersion")
	if err != nil || !versionPattern.MatchString(version) {
		return Install{}, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex bundle version is invalid"}
	}
	verify, err := run(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", root)
	if err != nil || verify != "" || bundleID != expectedBundleID {
		return Install{}, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex bundle identity or signature is invalid"}
	}
	display, err := run(ctx, "/usr/bin/codesign", "-dv", "--verbose=4", root)
	if err != nil {
		return Install{}, err
	}
	assessment, assessErr := run(ctx, "/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", root)
	if assessErr != nil {
		return Install{}, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex notarization assessment failed"}
	}
	team := teamPattern.FindStringSubmatch(display)
	authority := authorityPattern.FindStringSubmatch(display)
	if len(team) != 2 || len(authority) != 2 || strings.TrimSpace(team[1]) != expectedTeamID || strings.TrimSpace(authority[1]) != expectedResourceSigner || !strings.Contains(assessment, "source="+expectedNotarization) {
		return Install{}, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex signer or notarization is invalid"}
	}
	entryRelative := filepath.Join("Contents", "MacOS", executable)
	entry := filepath.Join(root, entryRelative)
	info, statErr := os.Stat(entry)
	if statErr != nil || !info.Mode().IsRegular() {
		return Install{}, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex bundle entry is invalid"}
	}
	return Install{PackageRoot: root, EntryPath: entry, PackageVersion: normalizeVersion(version), EntryRelativePath: filepath.ToSlash(entryRelative)}, nil
}

func normalizeVersion(value string) string {
	parts := strings.Split(value, ".")
	for len(parts) < 4 {
		parts = append(parts, "0")
	}
	return strings.Join(parts, ".")
}

func validTimestamp(value string) bool {
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

func ListCodexRoots(ctx context.Context) ([]ProcessIdentity, error) {
	roots, err := candidateBundleRoots()
	if err != nil || len(roots) == 0 {
		return nil, err
	}
	entries := make(map[string]struct{}, len(roots))
	for _, root := range roots {
		executable, readErr := runValue(ctx, "/usr/bin/plutil", "-extract", "CFBundleExecutable", "raw", "-o", "-", filepath.Join(root, "Contents", "Info.plist"))
		if readErr != nil {
			return nil, readErr
		}
		entries[filepath.Join(root, "Contents", "MacOS", executable)] = struct{}{}
	}
	processes, err := processRows(ctx)
	if err != nil {
		return nil, err
	}
	all := make(map[int]struct{})
	for _, process := range processes {
		if _, ok := entries[process.ExecutablePath]; ok {
			all[process.PID] = struct{}{}
		}
	}
	result := make([]ProcessIdentity, 0, len(all))
	for _, process := range processes {
		if _, ok := all[process.PID]; !ok {
			continue
		}
		if _, child := all[process.ParentPID]; !child {
			result = append(result, process)
		}
	}
	return result, nil
}

func RefuseUnmanagedCodex(ctx context.Context) error {
	roots, err := ListCodexRoots(ctx)
	if err != nil {
		return err
	}
	if len(roots) > 0 {
		return Error{Code: "CODEX_ALREADY_RUNNING_UNMANAGED", Message: "A normal Codex instance is already running"}
	}
	return nil
}

func LaunchManaged(ctx context.Context) (ManagedLaunch, error) {
	if err := RefuseUnmanagedCodex(ctx); err != nil {
		return ManagedLaunch{}, err
	}
	install, err := InspectOfficialCodex(ctx)
	if err != nil {
		return ManagedLaunch{}, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return ManagedLaunch{}, Error{Code: "CODEX_LAUNCH_FAILED", Message: "Could not reserve an IPv4 loopback CDP port"}
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return ManagedLaunch{}, err
	}
	launchedAfter := time.Now().UTC().Add(-time.Second)
	if _, err := run(ctx, "/usr/bin/open", "-n", install.PackageRoot, "--args", "--remote-debugging-address=127.0.0.1", fmt.Sprintf("--remote-debugging-port=%d", port)); err != nil {
		return ManagedLaunch{}, Error{Code: "CODEX_LAUNCH_FAILED", Message: err.Error()}
	}
	deadline := time.Now().Add(managedCDPReadyTimeout)
	for time.Now().Before(deadline) {
		roots, rootsErr := ListCodexRoots(ctx)
		if rootsErr != nil {
			return ManagedLaunch{}, rootsErr
		}
		for _, root := range roots {
			started, parseErr := time.Parse(time.RFC3339Nano, root.StartedAt)
			if parseErr != nil || started.Before(launchedAfter) || root.ExecutablePath != install.EntryPath {
				continue
			}
			portInfo, portErr := inspectPort(ctx, port)
			if portErr != nil {
				var platformError Error
				if errors.As(portErr, &platformError) && platformError.Code != "CDP_NOT_READY" {
					return ManagedLaunch{}, portErr
				}
				continue
			}
			if portInfo.host == "127.0.0.1" && containsPID(portInfo.ancestors, root.PID) {
				return ManagedLaunch{Install: install, Root: root, Port: port}, nil
			}
			return ManagedLaunch{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP endpoint is not owned by the managed Codex process"}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return ManagedLaunch{}, Error{Code: "CDP_NOT_READY", Message: "Managed Codex did not expose an owned IPv4 loopback CDP endpoint"}
}

// WaitForManagedExit observes only the managed root identity and never sends
// a signal to the official application.
func WaitForManagedExit(ctx context.Context, managed ProcessIdentity) error {
	if managed.PID < 1 || !validTimestamp(managed.StartedAt) || managed.ExecutablePath == "" {
		return Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Managed Codex identity is invalid"}
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		roots, err := ListCodexRoots(ctx)
		if err != nil {
			return err
		}
		found := false
		for _, root := range roots {
			if root.PID == managed.PID && root.StartedAt == managed.StartedAt && root.ExecutablePath == managed.ExecutablePath {
				found = true
				break
			}
		}
		if !found {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

type portIdentity struct {
	host      string
	owner     int
	ancestors []int
}

func inspectPort(ctx context.Context, port int) (portIdentity, error) {
	if port < 1 || port > 65535 {
		return portIdentity{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP port is invalid"}
	}
	output, err := run(ctx, "/usr/sbin/lsof", "-nP", fmt.Sprintf("-iTCP:%d", port), "-sTCP:LISTEN", "-Fpn")
	if err != nil || output == "" {
		return portIdentity{}, Error{Code: "CDP_NOT_READY", Message: "CDP endpoint is not ready"}
	}
	owner, host, parseErr := parseLsof(output, port)
	if parseErr != nil {
		return portIdentity{}, parseErr
	}
	if host != "127.0.0.1" {
		return portIdentity{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP listener is not bound to IPv4 loopback"}
	}
	processes, err := processRows(ctx)
	if err != nil {
		return portIdentity{}, err
	}
	parents := make(map[int]int, len(processes))
	for _, process := range processes {
		parents[process.PID] = process.ParentPID
	}
	ancestors := make([]int, 0, 8)
	seen := make(map[int]struct{})
	for cursor := owner; cursor > 0; cursor = parents[cursor] {
		if _, exists := seen[cursor]; exists {
			break
		}
		seen[cursor] = struct{}{}
		ancestors = append(ancestors, cursor)
	}
	if len(ancestors) == 0 {
		return portIdentity{}, Error{Code: "CDP_NOT_READY", Message: "CDP port owner is unavailable"}
	}
	return portIdentity{host: host, owner: owner, ancestors: ancestors}, nil
}

func parseLsof(output string, port int) (int, string, error) {
	owner, host := 0, ""
	for _, line := range strings.Split(output, "\n") {
		if len(line) < 2 {
			continue
		}
		switch line[0] {
		case 'p':
			value, err := strconv.Atoi(line[1:])
			if err != nil || value < 1 {
				return 0, "", Error{Code: "PROCESS_INSPECTION_DENIED", Message: "lsof returned an invalid process ID"}
			}
			owner = value
		case 'n':
			endpoint := strings.TrimSpace(line[1:])
			if strings.HasSuffix(endpoint, fmt.Sprintf(":%d", port)) {
				if owner == 0 || host != "" {
					return 0, "", Error{Code: "PROCESS_INSPECTION_DENIED", Message: "CDP port has multiple listening owners"}
				}
				host = strings.TrimSuffix(endpoint, fmt.Sprintf(":%d", port))
			}
		}
	}
	if owner < 1 || host == "" {
		return 0, "", Error{Code: "CDP_NOT_READY", Message: "CDP endpoint is not ready"}
	}
	return owner, host, nil
}

func processRows(ctx context.Context) ([]ProcessIdentity, error) {
	output, err := run(ctx, "/bin/ps", "-ww", "-axo", "pid=,ppid=,lstart=,command=")
	if err != nil {
		return nil, err
	}
	processes := make([]ProcessIdentity, 0)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		pid, pidErr := strconv.Atoi(fields[0])
		parent, parentErr := strconv.Atoi(fields[1])
		started, startedErr := time.Parse("Mon Jan _2 15:04:05 2006", strings.Join(fields[2:7], " "))
		if pidErr != nil || parentErr != nil || startedErr != nil || pid < 1 || parent < 0 {
			return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "macOS process inspection returned an invalid row"}
		}
		processes = append(processes, ProcessIdentity{PID: pid, ParentPID: parent, StartedAt: started.UTC().Format(time.RFC3339Nano), ExecutablePath: fields[7]})
	}
	return processes, nil
}

func runValue(ctx context.Context, executable string, args ...string) (string, error) {
	value, err := run(ctx, executable, args...)
	if err != nil || strings.TrimSpace(value) == "" {
		return "", Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex bundle metadata is unavailable"}
	}
	return strings.TrimSpace(value), nil
}

func run(ctx context.Context, executable string, args ...string) (string, error) {
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(commandContext, executable, args...)
	command.Env = append(os.Environ(), "LC_ALL=C", "TZ=UTC")
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", Error{Code: "PROCESS_INSPECTION_DENIED", Message: message}
	}
	return strings.TrimSpace(stdout.String() + "\n" + stderr.String()), nil
}

func containsPID(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
