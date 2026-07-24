package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/studio"
)

const goHostVersion = "0.3.0-alpha.1"

type RunningStudio = studio.RunningServer

func StartStudio(ctx context.Context) (*RunningStudio, error) {
	return startStudio(ctx, "")
}

func StartStudioDev(ctx context.Context, viteOrigin string) (*RunningStudio, error) {
	return startStudio(ctx, viteOrigin)
}

func startStudio(ctx context.Context, viteOrigin string) (*RunningStudio, error) {
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
	dataRoot, err := defaultDataRoot()
	if err != nil {
		return nil, commandError{code: "STUDIO_START_FAILED", message: "Studio data root could not be located"}
	}
	running, err := studio.Start(ctx, studio.Config{
		IndexHTML:     indexHTML,
		ThemeRoot:     filepath.Join(installRoot, "themes"),
		PersonalRoot:  filepath.Join(dataRoot, "theme-store"),
		StudioVersion: goHostVersion,
		RepositoryURL: &repositoryURL,
		ViteOrigin:    viteOrigin,
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
	candidates := make([]string, 0, 2)
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(executable))
	}
	if current, err := os.Getwd(); err == nil {
		candidates = append(candidates, current)
	}
	for _, candidate := range candidates {
		for root := candidate; ; root = filepath.Dir(root) {
			hasThemes := fileExists(filepath.Join(root, "themes", "catalog.json"))
			hasProductionUI := fileExists(filepath.Join(root, "apps", "theme-studio", "dist", "index.html"))
			if hasThemes && (!requireProductionUI || hasProductionUI) {
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

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
