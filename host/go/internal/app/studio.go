package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/studio"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

var goHostVersion = "0.3.1"

type RunningStudio = studio.RunningServer

func StartStudio(ctx context.Context) (*RunningStudio, error) {
	return startStudio(ctx, "", "")
}

func StartStudioDev(ctx context.Context, viteOrigin string) (*RunningStudio, error) {
	return startStudio(ctx, viteOrigin, "")
}

func startStudioWithDataRoot(ctx context.Context, dataRoot string) (*RunningStudio, error) {
	return startStudio(ctx, "", dataRoot)
}

func startStudio(ctx context.Context, viteOrigin, configuredDataRoot string) (*RunningStudio, error) {
	installRoot, err := findInstallRoot(viteOrigin == "")
	if err != nil {
		return nil, commandError{code: "STUDIO_START_FAILED", message: "Studio production assets could not be located"}
	}
	var indexHTML []byte
	if viteOrigin == "" {
		indexHTML, err = os.ReadFile(filepath.Join(installRoot, "apps", "theme-studio", "dist", "index.html"))
		if err != nil {
			return nil, commandError{code: "STUDIO_START_FAILED", message: "Studio production UI could not be read"}
		}
	}
	repositoryURL := "https://github.com/u2bo/OpenChatGPTSkin"
	dataRoot := configuredDataRoot
	if dataRoot == "" {
		dataRoot, err = defaultDataRoot()
		if err != nil {
			return nil, commandError{code: "STUDIO_START_FAILED", message: "Studio data root could not be located"}
		}
	}
	running, err := studio.Start(ctx, studio.Config{
		IndexHTML:    indexHTML,
		ThemeRoot:    filepath.Join(installRoot, "themes"),
		PersonalRoot: filepath.Join(dataRoot, "theme-store"),
		// Keep the v0.2 Node path exactly: Go and Node must share one draft
		// history during the provisional cutover and rollback window.
		DraftRoot:     filepath.Join(dataRoot, "theme-studio", "drafts"),
		StudioVersion: goHostVersion,
		RepositoryURL: &repositoryURL,
		RuntimeStatus: func() studio.RuntimeStatus { return readStudioRuntimeStatus(dataRoot) },
		ApplyTheme: func(requestContext context.Context, ref themerepo.Ref) (studio.RuntimeStatus, error) {
			return applyStudioTheme(requestContext, dataRoot, ref)
		},
		RestoreTheme: func(requestContext context.Context) (studio.RuntimeStatus, error) {
			return restoreStudioTheme(requestContext, dataRoot)
		},
		ViteOrigin: viteOrigin,
	})
	if err != nil {
		code := studio.ErrorCode(err)
		if code == "" {
			code = "STUDIO_START_FAILED"
		}
		return nil, commandError{code: code, message: err.Error()}
	}
	return running, nil
}

func findInstallRoot(requireProductionUI bool) (string, error) {
	executable, current := "", ""
	if value, err := os.Executable(); err == nil {
		executable = value
	}
	if value, err := os.Getwd(); err == nil {
		current = value
	}
	for _, candidate := range installRootCandidates(executable, current) {
		for root := candidate; ; root = filepath.Dir(root) {
			if isInstallRoot(root, requireProductionUI) {
				return root, nil
			}
			parent := filepath.Dir(root)
			if parent == root {
				break
			}
		}
	}
	return "", errors.New("Studio install root is unavailable")
}

func installRootCandidates(executable, current string) []string {
	candidates := make([]string, 0, 3)
	if executable != "" {
		directory := filepath.Dir(executable)
		candidates = append(candidates, directory)
		candidates = append(candidates, filepath.Clean(filepath.Join(directory, "..", "Resources", "payload")))
	}
	if current != "" {
		candidates = append(candidates, current)
	}
	return candidates
}

func isInstallRoot(root string, requireProductionUI bool) bool {
	hasThemes := fileExists(filepath.Join(root, "themes", "catalog.json"))
	hasProductionUI := fileExists(filepath.Join(root, "apps", "theme-studio", "dist", "index.html"))
	hasReleaseManifest := fileExists(filepath.Join(root, "release-manifest.json"))
	hasRepositoryMarkers := fileExists(filepath.Join(root, "package.json")) &&
		fileExists(filepath.Join(root, "host", "go", "go.mod"))
	return hasThemes && (!requireProductionUI || hasProductionUI) &&
		(hasReleaseManifest || hasRepositoryMarkers)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
