package themerepo

import (
	"archive/zip"
	"bytes"
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
	theme := `{"schemaVersion":4,"kind":"theme","appearance":"light","id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","author":"OpenChatGPTSkin","metadata":{"thumbnail":{"positionX":0.8,"positionY":0.35}},"assets":{"background":"assets/background.webp"},"colors":{},"typography":{},"background":{},"decorations":[],"layout":{},"rights":{"localOnly":false}}`
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "theme.json"), []byte(theme), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "preview.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(directory, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "assets", "background.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
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
	if library.Themes[0].ThumbnailPosition == nil ||
		library.Themes[0].ThumbnailPosition.PositionX != 0.8 ||
		library.Themes[0].ThumbnailPosition.PositionY != 0.35 {
		t.Fatalf("thumbnail position = %+v", library.Themes[0].ThumbnailPosition)
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

func TestRepositoryImportsExportsAndDeletesPersonalThemeAtomically(t *testing.T) {
	builtinRoot := t.TempDir()
	writeBuiltin(t, builtinRoot)
	personalRoot := t.TempDir()
	repository, err := OpenWithPersonal(builtinRoot, personalRoot)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := repository.Export("builtin", Ref{ID: "mountain-mist", Version: "1.3.0"})
	if err != nil {
		t.Fatal(err)
	}
	ref, err := repository.ImportArchive(archive)
	if err != nil {
		t.Fatal(err)
	}
	if ref != (Ref{ID: "mountain-mist", Version: "1.3.0"}) {
		t.Fatalf("imported ref = %+v", ref)
	}
	library, err := repository.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(library.Themes) != 2 || library.Themes[1].Source != "personal" {
		t.Fatalf("library = %+v", library)
	}
	reexported, err := repository.Export("personal", ref)
	if err != nil || !bytes.Equal(archive, reexported) {
		t.Fatalf("personal export error=%v same=%v", err, bytes.Equal(archive, reexported))
	}
	if err := repository.DeletePersonal(ref.ID, &ref.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Read("personal", ref); err == nil {
		t.Fatal("deleted personal theme was still readable")
	}
}

func TestRepositoryRejectsUnsafeArchiveEntry(t *testing.T) {
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	entry, err := writer.Create("../secret.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("secret")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := unpack(output.Bytes()); err == nil {
		t.Fatal("unsafe archive entry was accepted")
	}
}

func TestPackDirectoryAndUnpackToDirectoryAreCreateOnly(t *testing.T) {
	root := t.TempDir()
	writeBuiltin(t, root)
	source := filepath.Join(root, "builtin", "mountain-mist")
	archive, ref, err := PackDirectory(source)
	if err != nil || ref != (Ref{ID: "mountain-mist", Version: "1.3.0"}) {
		t.Fatalf("packed ref=%+v error=%v", ref, err)
	}

	output := filepath.Join(t.TempDir(), "unpacked")
	unpacked, err := UnpackToDirectory(archive, output)
	if err != nil || unpacked != ref {
		t.Fatalf("unpacked ref=%+v error=%v", unpacked, err)
	}
	for _, name := range []string{
		"theme.json",
		"manifest.json",
		"preview.webp",
		filepath.Join("assets", "background.webp"),
	} {
		if _, err := os.Stat(filepath.Join(output, name)); err != nil {
			t.Fatalf("unpacked file %q: %v", name, err)
		}
	}

	marker := filepath.Join(output, "keep.txt")
	if err := os.WriteFile(marker, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := UnpackToDirectory(archive, output); ErrorCodeFrom(err) != "CLI_WRITE" {
		t.Fatalf("existing destination error=%v code=%q", err, ErrorCodeFrom(err))
	}
	if contents, err := os.ReadFile(marker); err != nil || string(contents) != "keep" {
		t.Fatalf("existing destination changed: contents=%q error=%v", contents, err)
	}
}

func TestLoadDirectoryRejectsInvalidAssetSignature(t *testing.T) {
	root := t.TempDir()
	writeBuiltin(t, root)
	directory := filepath.Join(root, "builtin", "mountain-mist")
	if err := os.WriteFile(
		filepath.Join(directory, "assets", "background.webp"),
		[]byte("not-a-webp"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadDirectory(directory); ErrorCodeFrom(err) != "ASSET_SIGNATURE_INVALID" {
		t.Fatalf("invalid signature error=%v code=%q", err, ErrorCodeFrom(err))
	}
}

func TestRepositoryMigratesLegacyThemeAndRejectsUnknownFields(t *testing.T) {
	legacy := []byte(`{"schemaVersion":1,"kind":"theme","id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","author":"OpenChatGPTSkin","assets":{"background":"assets/background.webp"},"colors":{"accent":"#000000","secondary":"#000000","text":"#000000","muted":"#000000","panel":"#000000","border":"#000000","success":"#000000","warning":"#000000","danger":"#000000","info":"#000000"},"typography":{"uiFamily":"Sans","codeFamily":"Mono","scale":1,"uiSize":14,"codeSize":13,"uiWeight":400,"codeWeight":400,"lineHeight":1.5},"background":{"positionX":0.5,"positionY":0.5,"scale":1,"blur":0,"brightness":1,"overlay":0},"decorations":[],"layout":{},"rights":{"licenseId":"LicenseRef-Test","localOnly":false}}`)
	normalized, header, err := normalizeDocument(legacy)
	if err != nil || header.SchemaVersion != 4 || !bytes.Contains(normalized, []byte(`"composition"`)) {
		t.Fatalf("legacy normalization error=%v document=%s", err, normalized)
	}
	unknown := append([]byte(nil), normalized[:len(normalized)-2]...)
	unknown = append(unknown, []byte(`,"unknown":true}`)...)
	if _, _, err := normalizeDocument(unknown); err == nil {
		t.Fatal("unknown theme field was accepted")
	}
}

func FuzzUnpackRejectsMalformedArchives(f *testing.F) {
	f.Add([]byte("not a zip"))
	f.Add([]byte("PK\x03\x04"))
	f.Fuzz(func(t *testing.T, contents []byte) {
		if len(contents) > maxArchiveBytes {
			return
		}
		_, _ = unpack(contents)
	})
}
