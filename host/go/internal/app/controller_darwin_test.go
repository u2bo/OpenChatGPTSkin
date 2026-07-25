//go:build darwin

package app

import "testing"

func TestDarwinProcessIdentityIncludesCreationTime(t *testing.T) {
	pid, startedAt, err := currentProcessIdentity()
	if err != nil {
		t.Fatal(err)
	}
	if !processAlive(pid, startedAt) {
		t.Fatal("current process identity was not recognized")
	}
	if processAlive(pid, startedAt+"-changed") {
		t.Fatal("PID-only match accepted a changed creation time")
	}
}
