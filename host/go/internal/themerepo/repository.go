package themerepo

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

const maxPreviewBytes = 16 * 1024 * 1024

var (
	themeIDPattern      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	themeVersionPattern = regexp.MustCompile(`^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$`)
)

type Error struct {
	Code    string
	Message string
}

func (err Error) Error() string { return err.Message }

type Ref struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

type Localized struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}

type ListItem struct {
	Ref         Ref                  `json:"ref"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Author      string               `json:"author"`
	Homepage    *string              `json:"homepage"`
	Localized   map[string]Localized `json:"localized,omitempty"`
	Source      string               `json:"source"`
	Ready       bool                 `json:"ready"`
	LocalOnly   bool                 `json:"localOnly"`
	PreviewURL  *string              `json:"previewUrl"`
}

type Library struct {
	Themes []ListItem `json:"themes"`
}

type Asset struct {
	Bytes    []byte
	MIMEType string
}

type Repository struct {
	root         string
	personalRoot string
}

type catalog struct {
	SchemaVersion int            `json:"schemaVersion"`
	Builtins      []catalogEntry `json:"builtins"`
	Recipes       []catalogEntry `json:"recipes"`
}

type catalogEntry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Path      string `json:"path"`
	Ready     bool   `json:"ready"`
	LocalOnly bool   `json:"localOnly"`
	LicenseID string `json:"licenseId"`
	Preview   string `json:"preview,omitempty"`
}

type themeHeader struct {
	SchemaVersion int    `json:"schemaVersion"`
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	Version       string `json:"version"`
	Author        string `json:"author"`
	Metadata      struct {
		Homepage  *string              `json:"homepage"`
		Localized map[string]Localized `json:"localized,omitempty"`
	} `json:"metadata,omitempty"`
	Rights struct {
		LocalOnly bool `json:"localOnly"`
	} `json:"rights"`
}

func Open(root string) (*Repository, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	return &Repository{root: absolute}, nil
}

func OpenWithPersonal(root, personalRoot string) (*Repository, error) {
	repository, err := Open(root)
	if err != nil {
		return nil, err
	}
	if personalRoot == "" {
		return repository, nil
	}
	absolute, err := filepath.Abs(personalRoot)
	if err != nil {
		return nil, err
	}
	repository.personalRoot = absolute
	return repository, nil
}

func (repository *Repository) List() (Library, error) {
	catalog, err := repository.loadCatalog()
	if err != nil {
		return Library{}, err
	}
	items := make([]ListItem, 0, len(catalog.Builtins)+len(catalog.Recipes))
	for _, entry := range append(catalog.Builtins, catalog.Recipes...) {
		item, err := repository.libraryItem(entry)
		if err != nil {
			return Library{}, err
		}
		items = append(items, item)
	}
	personal, err := repository.listPersonal()
	if err != nil {
		return Library{}, err
	}
	items = append(items, personal...)
	return Library{Themes: items}, nil
}

func (repository *Repository) Preview(source string, ref Ref) (Asset, error) {
	if source == "personal" {
		return repository.readPersonalPreview(ref)
	}
	if source != "builtin" {
		return Asset{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme preview source is unavailable"}
	}
	entry, err := repository.findBuiltin(ref)
	if err != nil {
		return Asset{}, err
	}
	if entry.Preview == "" {
		return Asset{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme preview is unavailable"}
	}
	path, err := repository.safePath(entry.Preview)
	if err != nil {
		return Asset{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return Asset{}, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxPreviewBytes {
		return Asset{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme preview is invalid"}
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return Asset{}, err
	}
	return Asset{Bytes: contents, MIMEType: "image/webp"}, nil
}

func (repository *Repository) loadCatalog() (catalog, error) {
	contents, err := os.ReadFile(filepath.Join(repository.root, "catalog.json"))
	if err != nil {
		return catalog{}, err
	}
	var value catalog
	if err := decodeStrict(contents, &value); err != nil {
		return catalog{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme catalog is invalid"}
	}
	if value.SchemaVersion != 1 {
		return catalog{}, Error{Code: "THEME_SCHEMA_VERSION_UNSUPPORTED", Message: "Theme catalog schema is unsupported"}
	}
	seen := make(map[string]struct{}, len(value.Builtins)+len(value.Recipes))
	for _, entry := range value.Builtins {
		if entry.Kind != "theme" {
			return catalog{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Builtin catalog contains a non-theme entry"}
		}
		if err := validateCatalogEntry(entry); err != nil {
			return catalog{}, err
		}
		if _, exists := seen[entry.ID]; exists {
			return catalog{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme catalog has duplicate IDs"}
		}
		seen[entry.ID] = struct{}{}
	}
	for _, entry := range value.Recipes {
		if entry.Kind != "recipe" {
			return catalog{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Recipe catalog contains a non-recipe entry"}
		}
		if err := validateCatalogEntry(entry); err != nil {
			return catalog{}, err
		}
		if _, exists := seen[entry.ID]; exists {
			return catalog{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme catalog has duplicate IDs"}
		}
		seen[entry.ID] = struct{}{}
	}
	return value, nil
}

func validateCatalogEntry(entry catalogEntry) error {
	if !validRef(Ref{ID: entry.ID, Version: entry.Version}) || entry.Name == "" || entry.LicenseID == "" {
		return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme catalog entry is invalid"}
	}
	if entry.Kind == "theme" {
		expectedPath := filepath.ToSlash(filepath.Join("builtin", entry.ID))
		expectedPreview := filepath.ToSlash(filepath.Join(expectedPath, "preview.webp"))
		if entry.Path != expectedPath || entry.Preview != expectedPreview || !entry.Ready || entry.LocalOnly {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Builtin theme catalog entry is inconsistent"}
		}
		return nil
	}
	if entry.Kind == "recipe" {
		expectedPath := filepath.ToSlash(filepath.Join("recipes", entry.ID))
		if entry.Path != expectedPath || entry.Ready || !entry.LocalOnly || entry.Preview != "" {
			return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme recipe catalog entry is inconsistent"}
		}
		return nil
	}
	return Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme catalog kind is invalid"}
}

func (repository *Repository) libraryItem(entry catalogEntry) (ListItem, error) {
	header, err := repository.readHeader(entry)
	if err != nil {
		return ListItem{}, err
	}
	if header.ID != entry.ID || header.Version != entry.Version || header.Name != entry.Name || header.Kind != entry.Kind {
		return ListItem{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme metadata differs from its catalog entry"}
	}
	if entry.Kind == "theme" && header.Rights.LocalOnly {
		return ListItem{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Builtin theme cannot be local only"}
	}
	var previewURL *string
	if entry.Preview != "" {
		value := "/api/theme-preview?source=builtin&id=" + entry.ID + "&version=" + entry.Version
		previewURL = &value
	}
	return ListItem{
		Ref:         Ref{ID: entry.ID, Version: entry.Version},
		Name:        header.Name,
		Description: header.Description,
		Author:      header.Author,
		Homepage:    header.Metadata.Homepage,
		Localized:   header.Metadata.Localized,
		Source:      map[bool]string{true: "builtin", false: "recipe"}[entry.Kind == "theme"],
		Ready:       entry.Ready,
		LocalOnly:   entry.LocalOnly,
		PreviewURL:  previewURL,
	}, nil
}

func (repository *Repository) findBuiltin(ref Ref) (catalogEntry, error) {
	if !validRef(ref) {
		return catalogEntry{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme reference is invalid"}
	}
	catalog, err := repository.loadCatalog()
	if err != nil {
		return catalogEntry{}, err
	}
	for _, entry := range catalog.Builtins {
		if entry.ID == ref.ID && entry.Version == ref.Version {
			return entry, nil
		}
	}
	return catalogEntry{}, Error{Code: "THEME_NOT_FOUND", Message: "Theme does not exist"}
}

func (repository *Repository) readHeader(entry catalogEntry) (themeHeader, error) {
	path, err := repository.safePath(filepath.ToSlash(filepath.Join(entry.Path, "theme.json")))
	if err != nil {
		return themeHeader{}, err
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return themeHeader{}, err
	}
	var document map[string]json.RawMessage
	if err := decodeStrict(contents, &document); err != nil {
		return themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme document is invalid"}
	}
	for name := range document {
		switch name {
		case "schemaVersion", "kind", "appearance", "id", "name", "description", "version", "author", "metadata", "assets", "colors", "typography", "background", "surfaces", "decorations", "layout", "rights", "interfaceImages", "home", "welcome", "composition":
		default:
			return themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme document has an unknown field"}
		}
	}
	var header themeHeader
	if err := json.Unmarshal(contents, &header); err != nil {
		return themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme metadata is invalid"}
	}
	if header.SchemaVersion != 4 || !validRef(Ref{ID: header.ID, Version: header.Version}) || header.Name == "" || header.Author == "" {
		return themeHeader{}, Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme metadata is invalid"}
	}
	return header, nil
}

func (repository *Repository) safePath(relative string) (string, error) {
	if relative == "" || filepath.IsAbs(relative) {
		return "", Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme path is invalid"}
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == "." || clean == ".." || len(clean) >= 3 && clean[:3] == ".."+string(filepath.Separator) {
		return "", Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme path escapes its root"}
	}
	path := filepath.Join(repository.root, clean)
	relativeToRoot, err := filepath.Rel(repository.root, path)
	if err != nil || relativeToRoot == ".." || len(relativeToRoot) >= 3 && relativeToRoot[:3] == ".."+string(filepath.Separator) {
		return "", Error{Code: "THEME_SCHEMA_INVALID", Message: "Theme path escapes its root"}
	}
	return path, nil
}

func validRef(ref Ref) bool {
	return len(ref.ID) >= 3 && len(ref.ID) <= 80 && themeIDPattern.MatchString(ref.ID) && themeVersionPattern.MatchString(ref.Version)
}

func decodeStrict(contents []byte, output any) error {
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("JSON has trailing content")
	}
	return nil
}
