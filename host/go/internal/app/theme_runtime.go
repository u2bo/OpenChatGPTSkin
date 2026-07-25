package app

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/cdp"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

type managedThemeSession interface {
	Apply(context.Context, cdp.ThemePayload) error
	Restore(context.Context) error
	WaitForExit(context.Context) error
	Close() error
}

type sessionFactory func(context.Context) (managedThemeSession, error)
type themeLoader func(themerepo.Ref) (cdp.ThemePayload, error)

const (
	compatibleTargetReadyTimeout  = 20 * time.Second
	compatibleTargetRetryInterval = 200 * time.Millisecond
)

// waitForCompatibleTarget distinguishes a listening CDP port from a renderer
// whose workbench DOM has finished initializing. The platform adapters have
// already verified the port owner before this runs; only transient discovery
// and adapter-readiness failures are retried.
func waitForCompatibleTarget(ctx context.Context, endpoint cdp.Endpoint) (cdp.Target, error) {
	readyContext, cancel := context.WithTimeout(ctx, compatibleTargetReadyTimeout)
	defer cancel()

	var lastErr error
	for {
		targets, err := cdp.Discover(readyContext, endpoint)
		if err == nil {
			var target cdp.Target
			target, err = cdp.SelectCompatibleCodexTarget(readyContext, endpoint, targets)
			if err == nil {
				return target, nil
			}
		}
		if !retryableTargetReadinessError(err) {
			return cdp.Target{}, err
		}
		lastErr = err

		timer := time.NewTimer(compatibleTargetRetryInterval)
		select {
		case <-readyContext.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return cdp.Target{}, lastErr
		case <-timer.C:
		}
	}
}

func retryableTargetReadinessError(err error) bool {
	var adapterError cdp.Error
	return errors.As(err, &adapterError) && (adapterError.Code == "CDP_NOT_READY" || adapterError.Code == "ADAPTER_INCOMPATIBLE")
}

func defaultThemeLoader(dataRoot string) themeLoader {
	return func(ref themerepo.Ref) (cdp.ThemePayload, error) {
		installRoot, err := findInstallRoot(false)
		if err != nil {
			return cdp.ThemePayload{}, commandError{code: "THEME_NOT_FOUND", message: "Installed themes are unavailable"}
		}
		repository, err := themerepo.OpenWithPersonal(filepath.Join(installRoot, "themes"), filepath.Join(dataRoot, "theme-store"))
		if err != nil {
			return cdp.ThemePayload{}, err
		}
		resolved, err := resolveThemeRef(repository, ref)
		if err != nil {
			return cdp.ThemePayload{}, err
		}
		bundle, err := repository.Read("builtin", resolved)
		if err != nil {
			bundle, err = repository.Read("personal", resolved)
			if err != nil {
				return cdp.ThemePayload{}, err
			}
		}
		files := make(map[string][]byte, len(bundle.Files))
		total := len(bundle.Document)
		for path, contents := range bundle.Files {
			files[path] = append([]byte(nil), contents...)
			total += len(contents)
		}
		return cdp.ThemePayload{Document: json.RawMessage(append([]byte(nil), bundle.Document...)), Files: files, TotalBytes: total}, nil
	}
}

func resolveThemeRef(repository *themerepo.Repository, requested themerepo.Ref) (themerepo.Ref, error) {
	if requested.Version != "" {
		return requested, nil
	}
	library, err := repository.List()
	if err != nil {
		return themerepo.Ref{}, err
	}
	candidates := make([]themerepo.Ref, 0)
	for _, theme := range library.Themes {
		if theme.Ref.ID == requested.ID && theme.Ready {
			candidates = append(candidates, theme.Ref)
		}
	}
	if len(candidates) == 0 {
		return themerepo.Ref{}, commandError{code: "THEME_NOT_FOUND", message: "Theme version is unavailable"}
	}
	sort.Slice(candidates, func(left, right int) bool { return semverGreater(candidates[left].Version, candidates[right].Version) })
	return candidates[0], nil
}

func semverGreater(left, right string) bool {
	parse := func(value string) [3]int {
		var result [3]int
		for index, part := range strings.Split(value, ".") {
			if index >= len(result) {
				break
			}
			result[index], _ = strconv.Atoi(part)
		}
		return result
	}
	a, b := parse(left), parse(right)
	for index := range a {
		if a[index] != b[index] {
			return a[index] > b[index]
		}
	}
	return false
}

func runtimeCommandError(err error, fallback string) error {
	if err == nil {
		return nil
	}
	var controlError control.CommandError
	if errors.As(err, &controlError) {
		return controlError
	}
	var command commandError
	if errors.As(err, &command) {
		return control.CommandError{Code: command.code, Message: command.message}
	}
	var repositoryError themerepo.Error
	if errors.As(err, &repositoryError) {
		return control.CommandError{Code: repositoryError.Code, Message: repositoryError.Message}
	}
	var adapterError cdp.Error
	if errors.As(err, &adapterError) {
		return control.CommandError{Code: adapterError.Code, Message: adapterError.Message}
	}
	return control.CommandError{Code: fallback, Message: "The Runtime theme operation could not be completed"}
}
