package themerepo

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	maxArchiveBytes  = 32 * 1024 * 1024
	maxExpandedBytes = 32 * 1024 * 1024
	maxAssetBytes    = 16 * 1024 * 1024
	maxFontBytes     = 5 * 1024 * 1024
)

type Bundle struct {
	Ref      Ref
	Document []byte
	Files    map[string][]byte
}

type archiveManifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	ThemeID       string `json:"themeId"`
	ThemeVersion  string `json:"themeVersion"`
	Files         map[string]struct {
		Bytes  int    `json:"bytes"`
		SHA256 string `json:"sha256"`
	} `json:"files"`
}

// ValidateArchive verifies that an .ocskin archive can be unpacked without
// persisting anything. It is used by compatibility verification and request
// validation before an import is committed.
func ValidateArchive(contents []byte) error {
	_, err := unpack(contents)
	return err
}

// ValidateDocument verifies a Theme Schema v1-v4 document, including the
// normalisation path used for imported archives.
func ValidateDocument(contents []byte) error {
	_, _, err := normalizeDocument(contents)
	return err
}

// NormalizeDocument returns the canonical Schema v4 encoding together with
// its identity. Workspace persistence uses this exact normalisation boundary
// so Go-written draft records remain consumable by the v0.2 Node rollback host.
func NormalizeDocument(contents []byte) ([]byte, Ref, error) {
	normalized, header, err := normalizeDocument(contents)
	if err != nil {
		return nil, Ref{}, err
	}
	return normalized, Ref{ID: header.ID, Version: header.Version}, nil
}

// AssetPaths returns the complete declared asset set in stable order.
func AssetPaths(document []byte) ([]string, error) {
	return assetPaths(document)
}

// ErrorCode exposes stable, user-safe theme repository error codes to the
// host boundary without leaking filesystem or archive implementation details.
func ErrorCodeFrom(err error) string {
	if err == nil {
		return ""
	}
	var themeError Error
	if errors.As(err, &themeError) {
		return themeError.Code
	}
	return "INTERNAL"
}

func (repository *Repository) ImportArchive(contents []byte) (Ref, error) {
	bundle, err := unpack(contents)
	if err != nil {
		return Ref{}, err
	}
	return repository.InstallPersonal(bundle)
}

func (repository *Repository) Export(source string, ref Ref) ([]byte, error) {
	bundle, err := repository.Read(source, ref)
	if err != nil {
		return nil, err
	}
	return pack(bundle)
}

func (repository *Repository) Read(source string, ref Ref) (Bundle, error) {
	if !validRef(ref) {
		return Bundle{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme reference is invalid"}
	}
	switch source {
	case "builtin":
		entry, err := repository.findBuiltin(ref)
		if err != nil {
			return Bundle{}, err
		}
		path, err := repository.safePath(entry.Path)
		if err != nil {
			return Bundle{}, err
		}
		return readBundleDirectory(path, ref)
	case "personal":
		return repository.readPersonal(ref)
	default:
		return Bundle{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme source is unavailable"}
	}
}

func (repository *Repository) InstallPersonal(bundle Bundle) (Ref, error) {
	if repository.personalRoot == "" {
		return Ref{}, Error{Code: "STUDIO_IMPORT_INVALID", Message: "Personal theme storage is unavailable"}
	}
	normalized, err := normalizeBundle(bundle)
	if err != nil {
		return Ref{}, err
	}
	target, err := repository.personalPath(normalized.Ref)
	if err != nil {
		return Ref{}, err
	}
	if _, err := os.Lstat(target); err == nil {
		existing, readErr := readBundleDirectory(target, normalized.Ref)
		if readErr != nil {
			return Ref{}, readErr
		}
		if bundlesEqual(existing, normalized) {
			return normalized.Ref, nil
		}
		return Ref{}, Error{Code: "THEME_VERSION_CONFLICT", Message: "Personal theme version already exists with different content"}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Ref{}, err
	}
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return Ref{}, err
	}
	staging, err := os.MkdirTemp(parent, ".theme-staging-")
	if err != nil {
		return Ref{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(staging)
		}
	}()
	if err := writeBundleDirectory(staging, normalized); err != nil {
		return Ref{}, err
	}
	if err := os.Rename(staging, target); err != nil {
		if errors.Is(err, os.ErrExist) {
			return Ref{}, Error{Code: "THEME_VERSION_CONFLICT", Message: "Personal theme version already exists"}
		}
		return Ref{}, err
	}
	committed = true
	return normalized.Ref, nil
}

func (repository *Repository) DeletePersonal(id string, version *string) error {
	if repository.personalRoot == "" {
		return Error{Code: "STUDIO_DELETE_FAILED", Message: "Personal theme storage is unavailable"}
	}
	if len(id) < 3 || len(id) > 80 || !themeIDPattern.MatchString(id) {
		return Error{Code: "STUDIO_DELETE_FAILED", Message: "Personal theme ID is invalid"}
	}
	if version != nil {
		if !themeVersionPattern.MatchString(*version) {
			return Error{Code: "STUDIO_DELETE_FAILED", Message: "Personal theme version is invalid"}
		}
		path, err := repository.personalPath(Ref{ID: id, Version: *version})
		if err != nil {
			return err
		}
		if err := removeOwnedDirectory(path); err != nil {
			return err
		}
		return removeEmptyDirectory(filepath.Dir(path))
	}
	path, err := repository.personalIDPath(id)
	if err != nil {
		return err
	}
	return removeOwnedDirectory(path)
}

func (repository *Repository) listPersonal() ([]ListItem, error) {
	if repository.personalRoot == "" {
		return nil, nil
	}
	root := filepath.Join(repository.personalRoot, "themes")
	ids, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	items := make([]ListItem, 0)
	for _, idEntry := range ids {
		if !idEntry.IsDir() || !themeIDPattern.MatchString(idEntry.Name()) {
			continue
		}
		versions, err := os.ReadDir(filepath.Join(root, idEntry.Name()))
		if err != nil {
			return nil, err
		}
		for _, versionEntry := range versions {
			if !versionEntry.IsDir() || !themeVersionPattern.MatchString(versionEntry.Name()) {
				continue
			}
			ref := Ref{ID: idEntry.Name(), Version: versionEntry.Name()}
			bundle, err := repository.readPersonal(ref)
			if err != nil {
				return nil, err
			}
			header, err := headerFromDocument(bundle.Document)
			if err != nil {
				return nil, err
			}
			var previewURL *string
			if _, exists := bundle.Files["preview.webp"]; exists {
				value := "/api/theme-preview?source=personal&id=" + ref.ID + "&version=" + ref.Version
				previewURL = &value
			}
			items = append(items, ListItem{
				Ref: ref, Name: header.Name, Description: header.Description, Author: header.Author,
				Homepage: header.Metadata.Homepage, Localized: header.Metadata.Localized,
				Source: "personal", Ready: true, LocalOnly: header.Rights.LocalOnly, PreviewURL: previewURL,
			})
		}
	}
	sort.Slice(items, func(left, right int) bool {
		return items[left].Ref.ID < items[right].Ref.ID || items[left].Ref.ID == items[right].Ref.ID && items[left].Ref.Version < items[right].Ref.Version
	})
	return items, nil
}

func (repository *Repository) readPersonal(ref Ref) (Bundle, error) {
	path, err := repository.personalPath(ref)
	if err != nil {
		return Bundle{}, err
	}
	return readBundleDirectory(path, ref)
}

func (repository *Repository) readPersonalPreview(ref Ref) (Asset, error) {
	bundle, err := repository.readPersonal(ref)
	if err != nil {
		return Asset{}, err
	}
	preview, exists := bundle.Files["preview.webp"]
	if !exists {
		return Asset{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme preview is unavailable"}
	}
	return Asset{Bytes: preview, MIMEType: "image/webp"}, nil
}

func (repository *Repository) personalPath(ref Ref) (string, error) {
	if !validRef(ref) {
		return "", Error{Code: "THEME_NOT_FOUND", Message: "Theme reference is invalid"}
	}
	return filepath.Join(repository.personalRoot, "themes", ref.ID, ref.Version), nil
}

func (repository *Repository) personalIDPath(id string) (string, error) {
	if len(id) < 3 || len(id) > 80 || !themeIDPattern.MatchString(id) {
		return "", Error{Code: "THEME_NOT_FOUND", Message: "Theme ID is invalid"}
	}
	return filepath.Join(repository.personalRoot, "themes", id), nil
}

func unpack(contents []byte) (Bundle, error) {
	if len(contents) == 0 || len(contents) > maxArchiveBytes {
		return Bundle{}, Error{Code: "PACKAGE_TOO_LARGE", Message: "Theme archive exceeds its size limit"}
	}
	reader, err := zip.NewReader(bytes.NewReader(contents), int64(len(contents)))
	if err != nil {
		return Bundle{}, Error{Code: "STUDIO_IMPORT_INVALID", Message: "Theme archive is invalid"}
	}
	files := make(map[string][]byte, len(reader.File))
	seen := make(map[string]struct{}, len(reader.File))
	expanded := int64(0)
	for _, file := range reader.File {
		if !safeArchiveName(file.Name) || file.Mode()&os.ModeSymlink != 0 {
			return Bundle{}, Error{Code: "ARCHIVE_ENTRY_UNSAFE", Message: "Theme archive contains an unsafe entry"}
		}
		folded := strings.ToLower(file.Name)
		if _, exists := seen[folded]; exists {
			return Bundle{}, Error{Code: "ARCHIVE_ENTRY_DUPLICATE", Message: "Theme archive contains duplicate entries"}
		}
		seen[folded] = struct{}{}
		if file.Name != "theme.json" && file.Name != "manifest.json" && file.Name != "preview.webp" && !safeThemePath(file.Name) {
			return Bundle{}, Error{Code: "ARCHIVE_ENTRY_UNSUPPORTED", Message: "Theme archive contains an unsupported entry"}
		}
		if file.UncompressedSize64 == 0 || file.UncompressedSize64 > maxExpandedBytes || expanded+int64(file.UncompressedSize64) > maxExpandedBytes {
			return Bundle{}, Error{Code: "PACKAGE_EXPANDED_TOO_LARGE", Message: "Theme archive expanded size exceeds its limit"}
		}
		expanded += int64(file.UncompressedSize64)
		contents, err := readZipFile(file, int64(file.UncompressedSize64))
		if err != nil {
			return Bundle{}, err
		}
		files[file.Name] = contents
	}
	themeBytes, hasTheme := files["theme.json"]
	manifestBytes, hasManifest := files["manifest.json"]
	if !hasTheme || !hasManifest {
		return Bundle{}, Error{Code: "ARCHIVE_REQUIRED_FILE_MISSING", Message: "Theme archive requires theme.json and manifest.json"}
	}
	var manifest archiveManifest
	if err := decodeStrict(manifestBytes, &manifest); err != nil || manifest.SchemaVersion != 1 || !validRef(Ref{ID: manifest.ThemeID, Version: manifest.ThemeVersion}) {
		return Bundle{}, Error{Code: "ARCHIVE_MANIFEST_INVALID", Message: "Theme archive manifest is invalid"}
	}
	actual := make([]string, 0, len(files)-1)
	for name := range files {
		if name != "manifest.json" {
			actual = append(actual, name)
		}
	}
	sort.Strings(actual)
	expected := make([]string, 0, len(manifest.Files))
	for name := range manifest.Files {
		expected = append(expected, name)
	}
	sort.Strings(expected)
	if strings.Join(actual, "\x00") != strings.Join(expected, "\x00") {
		return Bundle{}, Error{Code: "ARCHIVE_MANIFEST_MISMATCH", Message: "Theme archive entries differ from manifest"}
	}
	for name, expectedFile := range manifest.Files {
		contents := files[name]
		if len(contents) != expectedFile.Bytes || expectedFile.SHA256 != hash(contents) {
			return Bundle{}, Error{Code: "ARCHIVE_HASH_MISMATCH", Message: "Theme archive file hash differs from manifest"}
		}
	}
	normalized, header, err := normalizeDocument(themeBytes)
	if err != nil {
		return Bundle{}, err
	}
	ref := Ref{ID: header.ID, Version: header.Version}
	if ref.ID != manifest.ThemeID || ref.Version != manifest.ThemeVersion {
		return Bundle{}, Error{Code: "ARCHIVE_IDENTITY_MISMATCH", Message: "Theme archive identity differs from manifest"}
	}
	bundle := Bundle{Ref: ref, Document: normalized, Files: withoutManifest(files)}
	if err := validateBundleAssets(bundle); err != nil {
		return Bundle{}, err
	}
	return bundle, nil
}

func pack(bundle Bundle) ([]byte, error) {
	normalized, err := normalizeBundle(bundle)
	if err != nil {
		return nil, err
	}
	files := make(map[string][]byte, len(normalized.Files)+1)
	files["theme.json"] = normalized.Document
	for name, contents := range normalized.Files {
		files[name] = contents
	}
	manifest := archiveManifest{SchemaVersion: 1, ThemeID: normalized.Ref.ID, ThemeVersion: normalized.Ref.Version, Files: make(map[string]struct {
		Bytes  int    `json:"bytes"`
		SHA256 string `json:"sha256"`
	}, len(files))}
	for name, contents := range files {
		manifest.Files[name] = struct {
			Bytes  int    `json:"bytes"`
			SHA256 string `json:"sha256"`
		}{Bytes: len(contents), SHA256: hash(contents)}
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	files["manifest.json"] = append(manifestBytes, '\n')
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetModTime(time.Unix(0, 0).UTC())
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write(files[name]); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	if output.Len() > maxArchiveBytes {
		return nil, Error{Code: "PACKAGE_TOO_LARGE", Message: "Theme archive exceeds its size limit"}
	}
	return output.Bytes(), nil
}

func normalizeBundle(bundle Bundle) (Bundle, error) {
	document, header, err := normalizeDocument(bundle.Document)
	if err != nil {
		return Bundle{}, err
	}
	if bundle.Ref.ID != "" && bundle.Ref != (Ref{ID: header.ID, Version: header.Version}) {
		return Bundle{}, Error{Code: "ARCHIVE_IDENTITY_MISMATCH", Message: "Theme bundle identity is inconsistent"}
	}
	normalized := Bundle{Ref: Ref{ID: header.ID, Version: header.Version}, Document: document, Files: cloneFiles(bundle.Files)}
	if err := validateBundleAssets(normalized); err != nil {
		return Bundle{}, err
	}
	return normalized, nil
}

func readBundleDirectory(directory string, expected Ref) (Bundle, error) {
	info, err := os.Stat(directory)
	if errors.Is(err, os.ErrNotExist) {
		return Bundle{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme does not exist"}
	}
	if err != nil || !info.IsDir() {
		return Bundle{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme storage is invalid"}
	}
	document, err := os.ReadFile(filepath.Join(directory, "theme.json"))
	if err != nil {
		return Bundle{}, err
	}
	normalized, header, err := normalizeDocument(document)
	if err != nil {
		return Bundle{}, err
	}
	ref := Ref{ID: header.ID, Version: header.Version}
	if expected != (Ref{}) && ref != expected {
		return Bundle{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Stored theme identity is inconsistent"}
	}
	paths, err := assetPaths(normalized)
	if err != nil {
		return Bundle{}, err
	}
	files := make(map[string][]byte, len(paths)+1)
	for _, path := range paths {
		contents, err := readAsset(filepath.Join(directory, filepath.FromSlash(path)), path)
		if err != nil {
			return Bundle{}, err
		}
		files[path] = contents
	}
	if contents, err := readAsset(filepath.Join(directory, "preview.webp"), "preview.webp"); err == nil {
		files["preview.webp"] = contents
	} else if !errors.Is(err, os.ErrNotExist) {
		return Bundle{}, err
	}
	return Bundle{Ref: ref, Document: normalized, Files: files}, nil
}

func writeBundleDirectory(directory string, bundle Bundle) error {
	if err := writeAtomicFile(filepath.Join(directory, "theme.json"), bundle.Document); err != nil {
		return err
	}
	for name, contents := range bundle.Files {
		if !safeAssetName(name) {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme file path is invalid"}
		}
		path := filepath.Join(directory, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		if err := writeAtomicFile(path, contents); err != nil {
			return err
		}
	}
	return nil
}

func writeAtomicFile(path string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".openchatgptskin-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(contents); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	committed = true
	return nil
}

func normalizeDocument(contents []byte) ([]byte, themeHeader, error) {
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil {
		return nil, themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme document is invalid"}
	}
	version, err := schemaVersion(document)
	if err != nil || version < 1 || version > 4 {
		return nil, themeHeader{}, Error{Code: "THEME_SCHEMA_VERSION_UNSUPPORTED", Message: "Theme schema version is unsupported"}
	}
	if version < 4 {
		migrateToV4(document, version)
	}
	document["schemaVersion"] = 4
	if err := validateDocumentShape(document); err != nil {
		return nil, themeHeader{}, err
	}
	normalized, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, themeHeader{}, err
	}
	normalized = append(normalized, '\n')
	header, err := headerFromDocument(normalized)
	if err != nil {
		return nil, themeHeader{}, err
	}
	return normalized, header, nil
}

func schemaVersion(document map[string]any) (int, error) {
	value, ok := document["schemaVersion"].(json.Number)
	if !ok {
		return 0, errors.New("schema version is invalid")
	}
	version, err := value.Int64()
	return int(version), err
}

func validateDocumentShape(document map[string]any) error {
	for name := range document {
		switch name {
		case "schemaVersion", "kind", "appearance", "id", "name", "description", "version", "author", "metadata", "assets", "colors", "typography", "background", "surfaces", "decorations", "layout", "rights", "interfaceImages", "home", "welcome", "composition":
		default:
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme document has an unknown field"}
		}
	}
	for _, name := range []string{"kind", "id", "name", "version", "author", "assets", "colors", "typography", "background", "decorations", "layout", "rights"} {
		if _, exists := document[name]; !exists {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme document has a required field missing"}
		}
	}
	kind, _ := document["kind"].(string)
	if kind != "theme" && kind != "recipe" {
		return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme kind is invalid"}
	}
	assets, ok := document["assets"].(map[string]any)
	if !ok {
		return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme assets are invalid"}
	}
	if kind == "theme" {
		if background, exists := assets["background"].(string); !exists || !safeThemePath(background) {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme requires a valid background asset"}
		}
	}
	return nil
}

func migrateToV4(document map[string]any, version int) {
	if _, exists := document["appearance"]; !exists {
		document["appearance"] = "auto"
	}
	colors, _ := document["colors"].(map[string]any)
	if colors != nil {
		for name, fallback := range map[string]string{"textSecondary": "text", "link": "accent", "inputText": "text", "placeholder": "muted", "codeText": "text"} {
			if _, exists := colors[name]; !exists {
				colors[name] = colors[fallback]
			}
		}
	}
	if _, exists := document["surfaces"]; !exists {
		document["surfaces"] = map[string]any{"baseOpacity": 0.68, "elevatedOpacity": 0.92, "terminalOpacity": 0.82, "blur": 0}
	}
	background, _ := document["background"].(map[string]any)
	if background != nil {
		for name, fallback := range map[string]any{"safeArea": "auto", "taskMode": "full", "taskOpacity": 0.82} {
			if _, exists := background[name]; !exists {
				background[name] = fallback
			}
		}
	}
	typography, _ := document["typography"].(map[string]any)
	if typography != nil {
		if _, exists := typography["displayFamily"]; !exists {
			typography["displayFamily"] = typography["uiFamily"]
		}
		if _, exists := typography["displayWeight"]; !exists {
			typography["displayWeight"] = typography["uiWeight"]
		}
		if _, exists := typography["displayLineHeight"]; !exists {
			typography["displayLineHeight"] = typography["lineHeight"]
		}
		if _, exists := typography["displayLetterSpacing"]; !exists {
			typography["displayLetterSpacing"] = 0
		}
		if _, exists := typography["displaySize"]; !exists {
			typography["displaySize"] = 28
		}
	}
	if _, exists := document["interfaceImages"]; !exists {
		document["interfaceImages"] = map[string]any{"profileAvatarSize": 24, "suggestionIconSize": 20, "projectIconSize": 16}
	}
	if _, exists := document["composition"]; !exists {
		document["composition"] = map[string]any{"layers": []any{}}
	}
	_ = version
}

func headerFromDocument(contents []byte) (themeHeader, error) {
	var header themeHeader
	if err := json.Unmarshal(contents, &header); err != nil {
		return themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme metadata is invalid"}
	}
	if header.SchemaVersion != 4 || !validRef(Ref{ID: header.ID, Version: header.Version}) || header.Name == "" || header.Author == "" || (header.Kind != "theme" && header.Kind != "recipe") {
		return themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme metadata is invalid"}
	}
	return header, nil
}

func assetPaths(document []byte) ([]string, error) {
	var value struct {
		Assets struct {
			Background      string            `json:"background"`
			Portrait        string            `json:"portrait"`
			ProfileAvatar   string            `json:"profileAvatar"`
			Decorations     map[string]string `json:"decorations"`
			Fonts           map[string]string `json:"fonts"`
			SuggestionIcons map[string]string `json:"suggestionIcons"`
			ProjectIcons    []string          `json:"projectIcons"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(document, &value); err != nil {
		return nil, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme assets are invalid"}
	}
	paths := []string{value.Assets.Background, value.Assets.Portrait, value.Assets.ProfileAvatar}
	for _, entries := range []map[string]string{value.Assets.Decorations, value.Assets.Fonts, value.Assets.SuggestionIcons} {
		for _, path := range entries {
			paths = append(paths, path)
		}
	}
	paths = append(paths, value.Assets.ProjectIcons...)
	seen := make(map[string]struct{}, len(paths))
	output := make([]string, 0, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		if !safeThemePath(path) {
			return nil, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme asset path is invalid"}
		}
		if _, exists := seen[path]; !exists {
			seen[path] = struct{}{}
			output = append(output, path)
		}
	}
	sort.Strings(output)
	return output, nil
}

func validateBundleAssets(bundle Bundle) error {
	paths, err := assetPaths(bundle.Document)
	if err != nil {
		return err
	}
	declared := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		declared[path] = struct{}{}
		contents, exists := bundle.Files[path]
		if !exists || len(contents) == 0 || len(contents) > assetLimit(path) {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme declared asset is invalid"}
		}
	}
	for path, contents := range bundle.Files {
		if path == "preview.webp" {
			if len(contents) == 0 || len(contents) > 2*1024*1024 {
				return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme preview is invalid"}
			}
			continue
		}
		if _, exists := declared[path]; !exists || len(contents) == 0 || len(contents) > assetLimit(path) {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme has an undeclared or oversized asset"}
		}
	}
	return nil
}

func assetLimit(path string) int {
	if strings.HasSuffix(strings.ToLower(path), ".woff2") {
		return maxFontBytes
	}
	return maxAssetBytes
}

func safeArchiveName(name string) bool {
	return name != "" && name == strings.ToValidUTF8(name, "") && !strings.HasPrefix(name, "/") && !strings.Contains(name, "\\") &&
		!strings.Contains(name, ":") && !strings.Contains(name, "\x00") && !strings.HasSuffix(name, "/") &&
		!strings.Contains(name, "../") && !strings.HasPrefix(name, "..")
}

func safeThemePath(path string) bool {
	if path == "" || len(path) > 240 || strings.Contains(path, "\\") || strings.Contains(path, "\x00") || strings.HasPrefix(path, "/") || strings.Contains(path, "../") || strings.HasPrefix(path, "..") {
		return false
	}
	lower := strings.ToLower(path)
	return (strings.HasPrefix(path, "assets/") && (strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") || strings.HasSuffix(lower, ".webp"))) ||
		(strings.HasPrefix(path, "fonts/") && strings.HasSuffix(lower, ".woff2"))
}

func safeAssetName(path string) bool { return path == "preview.webp" || safeThemePath(path) }

func readZipFile(file *zip.File, limit int64) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	contents, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil || int64(len(contents)) > limit {
		return nil, Error{Code: "ARCHIVE_ENTRY_TOO_LARGE", Message: "Theme archive entry exceeds its limit"}
	}
	return contents, nil
}

func readAsset(path, name string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > int64(assetLimit(name)) {
		return nil, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme asset is invalid"}
	}
	return os.ReadFile(path)
}

func cloneFiles(files map[string][]byte) map[string][]byte {
	result := make(map[string][]byte, len(files))
	for name, contents := range files {
		result[name] = append([]byte(nil), contents...)
	}
	return result
}

func withoutManifest(files map[string][]byte) map[string][]byte {
	result := cloneFiles(files)
	delete(result, "manifest.json")
	delete(result, "theme.json")
	return result
}

func bundlesEqual(left, right Bundle) bool {
	if left.Ref != right.Ref || !bytes.Equal(left.Document, right.Document) || len(left.Files) != len(right.Files) {
		return false
	}
	for name, contents := range left.Files {
		if !bytes.Equal(contents, right.Files[name]) {
			return false
		}
	}
	return true
}

func hash(contents []byte) string {
	digest := sha256.Sum256(contents)
	return hex.EncodeToString(digest[:])
}

func removeOwnedDirectory(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Error{Code: "THEME_NOT_FOUND", Message: "Personal theme does not exist"}
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Error{Code: "STUDIO_DELETE_FAILED", Message: "Personal theme storage is invalid"}
	}
	return os.RemoveAll(path)
}

func removeEmptyDirectory(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrExist) {
		return nil
	}
	return err
}

func headerFromBundle(bundle Bundle) (themeHeader, error) { return headerFromDocument(bundle.Document) }

func formatRef(ref Ref) string { return fmt.Sprintf("%s@%s", ref.ID, ref.Version) }
