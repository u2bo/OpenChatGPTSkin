//go:build darwin

package macos

import (
	"errors"
	"testing"
)

func TestParseLsofAcceptsOneIPv4LoopbackOwner(t *testing.T) {
	owner, host, err := parseLsof("p412\nn127.0.0.1:9222\n", 9222)
	if err != nil || owner != 412 || host != "127.0.0.1" {
		t.Fatalf("owner=%d host=%q error=%v", owner, host, err)
	}
}

func TestParseLsofRejectsMultipleOwners(t *testing.T) {
	_, _, err := parseLsof("p412\nn127.0.0.1:9222\np413\nn127.0.0.1:9222\n", 9222)
	var platformError Error
	if !errors.As(err, &platformError) || platformError.Code != "PROCESS_INSPECTION_DENIED" {
		t.Fatalf("error=%v", err)
	}
}

func TestNormalizeVersionPadsToRuntimeContractWidth(t *testing.T) {
	if value := normalizeVersion("26.721"); value != "26.721.0.0" {
		t.Fatalf("version=%q", value)
	}
}
