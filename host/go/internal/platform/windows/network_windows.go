//go:build windows

package windows

import (
	"errors"
	"math/bits"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	addressFamilyIPv4    = 2
	tcpStateListen       = 2
	tcpTableOwnerPIDAll  = 5
	insufficientBuffer   = 122
	tcpTableHeaderLength = 4
)

var getExtendedTCPTable = windows.NewLazySystemDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")

type tcpRowOwnerPID struct {
	state      uint32
	localAddr  uint32
	localPort  uint32
	remoteAddr uint32
	remotePort uint32
	owningPID  uint32
}

func loopbackTCPPortOwner(port int) (int, error) {
	var size uint32
	result, _, _ := getExtendedTCPTable.Call(
		0, uintptr(unsafe.Pointer(&size)), 0, addressFamilyIPv4, tcpTableOwnerPIDAll, 0,
	)
	if result != insufficientBuffer || size < tcpTableHeaderLength {
		return 0, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows TCP owner table size is unavailable"}
	}
	buffer := make([]byte, size)
	result, _, _ = getExtendedTCPTable.Call(
		uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)), 0,
		addressFamilyIPv4, tcpTableOwnerPIDAll, 0,
	)
	if result != 0 {
		return 0, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows TCP owner table could not be read: " + syscall.Errno(result).Error()}
	}
	count := *(*uint32)(unsafe.Pointer(&buffer[0]))
	rowSize := int(unsafe.Sizeof(tcpRowOwnerPID{}))
	required := tcpTableHeaderLength + int(count)*rowSize
	if count > 65535 || required < tcpTableHeaderLength || required > len(buffer) {
		return 0, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows TCP owner table is invalid"}
	}
	owner := 0
	for index := 0; index < int(count); index++ {
		offset := tcpTableHeaderLength + index*rowSize
		row := *(*tcpRowOwnerPID)(unsafe.Pointer(&buffer[offset]))
		if row.state != tcpStateListen || tcpPort(row.localPort) != port || !isIPv4Loopback(row.localAddr) {
			continue
		}
		if row.owningPID == 0 || owner != 0 {
			return 0, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP loopback listener ownership is ambiguous"}
		}
		owner = int(row.owningPID)
	}
	if owner == 0 {
		return 0, Error{Code: "CDP_NOT_READY", Message: "CDP endpoint is not ready"}
	}
	return owner, nil
}

func tcpPort(value uint32) int {
	return int(bits.ReverseBytes16(uint16(value)))
}

func isIPv4Loopback(value uint32) bool {
	bytes := *(*[4]byte)(unsafe.Pointer(&value))
	return bytes == [4]byte{127, 0, 0, 1}
}

func processAncestors(processID, managedRootPID int) ([]int, error) {
	if processID < 1 || managedRootPID < 1 {
		return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "CDP owner process is invalid"}
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows process snapshot could not be read: " + err.Error()}
	}
	defer windows.CloseHandle(snapshot)

	parents := make(map[int]int)
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows process snapshot is empty: " + err.Error()}
	}
	for {
		parents[int(entry.ProcessID)] = int(entry.ParentProcessID)
		err = windows.Process32Next(snapshot, &entry)
		if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
			break
		}
		if err != nil {
			return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows process snapshot is incomplete: " + err.Error()}
		}
	}

	return buildProcessAncestors(processID, managedRootPID, parents)
}

func buildProcessAncestors(processID, managedRootPID int, parents map[int]int) ([]int, error) {
	ancestors := make([]int, 0, 8)
	seen := make(map[int]struct{}, 8)
	for cursor := processID; cursor > 0; {
		if _, exists := seen[cursor]; exists {
			return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP owner process ancestry contains a cycle"}
		}
		seen[cursor] = struct{}{}
		ancestors = append(ancestors, cursor)
		if cursor == managedRootPID {
			return ancestors, nil
		}
		parent, exists := parents[cursor]
		if !exists || parent <= 0 {
			break
		}
		cursor = parent
	}
	return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP owner process ancestry does not reach the managed Codex root"}
}
