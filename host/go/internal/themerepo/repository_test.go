package themerepo

import (
	"os"
	"path/filepath"
	"testing"
)

func writeBuiltin(t *testing.T, root string) {
	t.Helper()
	directory := filepath.Join(root, "builtin", "mountain-mist")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	catalog := `{"schemaVersion":1,"builtins":[{"id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","kind":"theme","path":"builtin/mountain-mist","ready":true,"localOnly":false,"licenseId":"LicenseRef-Test","preview":"builtin/mountain-mist/preview.webp"}],"recipes":[]}`
	theme := `{"schemaVersion":4,"kind":"theme","appearance":"light","id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","author":"OpenChatGPTSkin","rights":{"localOnly":false}}`
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "theme.json"), []byte(theme), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "preview.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRepositoryListsBuiltinsAndReadsDeclaredPreview(t *testing.T) {
	root := t.TempDir()
	writeBuiltin(t, root)
	repository, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	library, err := repository.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(library.Themes) != 1 || library.Themes[0].Source != "builtin" {
		t.Fatalf("library = %+v", library)
	}
	asset, err := repository.Preview("builtin", Ref{ID: "mountain-mist", Version: "1.3.0"})
	if err != nil || asset.MIMEType != "image/webp" {
		t.Fatalf("preview = %+v error=%v", asset, err)
	}
}

func TestRepositoryRejectsCatalogAndDocumentPathEscapes(t *testing.T) {
	root := t.TempDir()
	writeBuiltin(t, root)
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), []byte(`{"schemaVersion":1,"builtins":[{"id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","kind":"theme","path":"../escape","ready":true,"localOnly":false,"licenseId":"LicenseRef-Test","preview":"builtin/mountain-mist/preview.webp"}],"recipes":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	repository, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.List(); err == nil {
		t.Fatal("path escaping catalog entry was accepted")
	}
}
