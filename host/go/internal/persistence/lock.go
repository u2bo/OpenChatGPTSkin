package persistence

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Identity struct {
	SchemaVersion int    `json:"schemaVersion"`
	PID           int    `json:"pid"`
	StartedAt     string `json:"startedAt"`
}

type Inspector func(pid int, startedAt string) bool

var errBusy = errors.New("controller lock is busy")

type Lock struct {
	path     string
	identity Identity
}

func validateIdentity(identity Identity) (Identity, error) {
	if identity.SchemaVersion != 1 {
		return Identity{}, errors.New("controller lock schema version is invalid")
	}
	if identity.PID <= 0 || identity.StartedAt == "" {
		return Identity{}, errors.New("controller lock identity is invalid")
	}
	return identity, nil
}

func normalizeRequestedIdentity(identity Identity) (Identity, error) {
	identity.SchemaVersion = 1
	return validateIdentity(identity)
}

func writeExclusive(path string, identity Identity) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		_ = file.Close()
		if !complete {
			_ = os.Remove(path)
		}
	}()
	encoder := json.NewEncoder(file)
	writeErr := encoder.Encode(identity)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	complete = true
	return nil
}

func readIdentity(path string) (Identity, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return Identity{}, err
	}
	var identity Identity
	if err := json.Unmarshal(contents, &identity); err != nil {
		return Identity{}, err
	}
	return validateIdentity(identity)
}

func Acquire(path string, requested Identity, inspect Inspector) (*Lock, error) {
	identity, err := normalizeRequestedIdentity(requested)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := writeExclusive(path, identity); err == nil {
		return &Lock{path: path, identity: identity}, nil
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	existing, err := readIdentity(path)
	if err != nil {
		return nil, fmt.Errorf("read existing controller lock: %w", err)
	}
	if inspect(existing.PID, existing.StartedAt) {
		return nil, errBusy
	}
	stale := fmt.Sprintf("%s.stale-%d", path, os.Getpid())
	if err := os.Rename(path, stale); err != nil {
		return nil, errBusy
	}
	defer os.Remove(stale)
	if err := writeExclusive(path, identity); err != nil {
		return nil, err
	}
	return &Lock{path: path, identity: identity}, nil
}

func IsBusy(err error) bool {
	return errors.Is(err, errBusy)
}

func (lock *Lock) Release() error {
	current, err := readIdentity(lock.path)
	if err != nil {
		return err
	}
	if current != lock.identity {
		return errors.New("controller lock ownership changed")
	}
	return os.Remove(lock.path)
}
