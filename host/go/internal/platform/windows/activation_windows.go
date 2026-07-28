//go:build windows

package windows

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	applicationActivationManagerCLSID = "{45BA127D-10A8-46EA-8AB7-56EA9078943C}"
	applicationActivationManagerIID   = "{2E941141-7F97-4756-BA1D-9DECDE894A3D}"
)

var coCreateInstance = windows.NewLazySystemDLL("ole32.dll").NewProc("CoCreateInstance")

type applicationActivationManager struct {
	vtable *applicationActivationManagerVTable
}

type applicationActivationManagerVTable struct {
	queryInterface      uintptr
	addRef              uintptr
	release             uintptr
	activateApplication uintptr
	activateForFile     uintptr
	activateForProtocol uintptr
}

type windowsApplicationActivator struct{}

func (windowsApplicationActivator) ActivateApplication(appUserModelID, arguments string) (uint32, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	initialized, err := initializeCOM()
	if err != nil {
		return 0, err
	}
	if initialized {
		defer windows.CoUninitialize()
	}

	manager, err := newApplicationActivationManager()
	if err != nil {
		return 0, err
	}
	defer manager.Release()
	return manager.ActivateApplication(appUserModelID, arguments)
}

func initializeCOM() (bool, error) {
	err := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED|windows.COINIT_DISABLE_OLE1DDE)
	if err == nil || errors.Is(err, syscall.Errno(uintptr(windows.S_FALSE))) {
		return true, nil
	}
	if errors.Is(err, syscall.Errno(uintptr(windows.RPC_E_CHANGED_MODE))) {
		return false, nil
	}
	return false, err
}

func newApplicationActivationManager() (*applicationActivationManager, error) {
	classID, err := windows.GUIDFromString(applicationActivationManagerCLSID)
	if err != nil {
		return nil, err
	}
	interfaceID, err := windows.GUIDFromString(applicationActivationManagerIID)
	if err != nil {
		return nil, err
	}
	var object unsafe.Pointer
	result, _, _ := coCreateInstance.Call(
		uintptr(unsafe.Pointer(&classID)),
		0,
		uintptr(windows.CLSCTX_LOCAL_SERVER),
		uintptr(unsafe.Pointer(&interfaceID)),
		uintptr(unsafe.Pointer(&object)),
	)
	if err := hresultError(result); err != nil {
		return nil, err
	}
	if object == nil {
		return nil, errors.New("application activation manager returned a null interface")
	}
	return (*applicationActivationManager)(object), nil
}

func (manager *applicationActivationManager) ActivateApplication(appUserModelID, arguments string) (uint32, error) {
	appUserModelIDPointer, err := windows.UTF16PtrFromString(appUserModelID)
	if err != nil {
		return 0, err
	}
	argumentsPointer, err := windows.UTF16PtrFromString(arguments)
	if err != nil {
		return 0, err
	}
	var processID uint32
	result, _, _ := syscall.SyscallN(
		manager.vtable.activateApplication,
		uintptr(unsafe.Pointer(manager)),
		uintptr(unsafe.Pointer(appUserModelIDPointer)),
		uintptr(unsafe.Pointer(argumentsPointer)),
		0,
		uintptr(unsafe.Pointer(&processID)),
	)
	runtime.KeepAlive(appUserModelIDPointer)
	runtime.KeepAlive(argumentsPointer)
	if err := hresultError(result); err != nil {
		return 0, err
	}
	return processID, nil
}

func (manager *applicationActivationManager) Release() {
	if manager == nil || manager.vtable == nil || manager.vtable.release == 0 {
		return
	}
	_, _, _ = syscall.SyscallN(manager.vtable.release, uintptr(unsafe.Pointer(manager)))
}

func hresultError(result uintptr) error {
	if int32(result) >= 0 {
		return nil
	}
	return syscall.Errno(result)
}
