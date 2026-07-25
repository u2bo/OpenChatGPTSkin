package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

const maxRuntimeThemeArchiveBytes = 32 * 1024 * 1024

type runtimeThemeRepository interface {
	List() (themerepo.Library, error)
	ImportArchive([]byte) (themerepo.Ref, error)
}

type runtimeThemeCommand struct {
	name      string
	dataRoot  string
	themeFile string
}

func requestID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(value)
	return hexValue[:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:], nil
}

func startDetachedController(ctx context.Context, executable, dataRoot string) error {
	startupID, err := requestID()
	if err != nil {
		return err
	}
	startupFile := filepath.Join(dataRoot, ".startup-"+startupID+".json")
	command := exec.Command(executable,
		"controller",
		"--startup-id", startupID,
		"--startup-file", startupFile,
		"--data-root", dataRoot,
	)
	configureDetached(command)
	null, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer null.Close()
	command.Stdin, command.Stdout, command.Stderr = null, null, null
	if err := command.Start(); err != nil {
		return err
	}
	startupContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := waitForHandshake(startupContext, startupFile, startupID); err != nil {
		_ = command.Process.Kill()
		_ = os.Remove(startupFile)
		return err
	}
	return command.Process.Release()
}

func sendRuntime(ctx context.Context, dataRoot string, request control.Request) (control.Response, error) {
	endpoint := controlEndpoint(dataRoot)
	return control.RoundTrip(ctx, func() (control.Connection, error) { return dialControl(endpoint) }, request)
}

func parseRuntimeThemeCommand(arguments []string) (runtimeThemeCommand, error) {
	if len(arguments) == 0 || arguments[0] != "list-themes" && arguments[0] != "import" {
		return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "runtime theme command is invalid"}
	}
	command := runtimeThemeCommand{name: arguments[0]}
	for index := 1; index < len(arguments); index++ {
		switch arguments[index] {
		case "--data-root", "--theme-file":
			name := arguments[index]
			index++
			if index >= len(arguments) || arguments[index] == "" || len(arguments[index]) > 4096 || containsNull(arguments[index]) {
				return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: name + " requires a valid value"}
			}
			if name == "--data-root" {
				if command.dataRoot != "" {
					return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--data-root may be specified only once"}
				}
				command.dataRoot = arguments[index]
			} else {
				if command.themeFile != "" {
					return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme-file may be specified only once"}
				}
				command.themeFile = arguments[index]
			}
		default:
			return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown runtime option: " + arguments[index]}
		}
	}
	if command.name == "list-themes" && command.themeFile != "" {
		return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme-file is valid only for import"}
	}
	if command.name == "import" && command.themeFile == "" {
		return runtimeThemeCommand{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme-file is required for import"}
	}
	return command, nil
}

func containsNull(value string) bool {
	for _, character := range value {
		if character == 0 {
			return true
		}
	}
	return false
}

func readRuntimeThemeArchive(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, commandError{code: "STUDIO_IMPORT_INVALID", message: "Theme archive could not be opened"}
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxRuntimeThemeArchiveBytes {
		return nil, commandError{code: "STUDIO_IMPORT_INVALID", message: "Theme archive size is invalid"}
	}
	contents, err := io.ReadAll(io.LimitReader(file, maxRuntimeThemeArchiveBytes+1))
	if err != nil || len(contents) < 1 || len(contents) > maxRuntimeThemeArchiveBytes {
		return nil, commandError{code: "STUDIO_IMPORT_INVALID", message: "Theme archive could not be read"}
	}
	return contents, nil
}

func executeRuntimeThemeCommand(command runtimeThemeCommand, repository runtimeThemeRepository) (any, error) {
	if command.name == "list-themes" {
		return repository.List()
	}
	contents, err := readRuntimeThemeArchive(command.themeFile)
	if err != nil {
		return nil, err
	}
	ref, err := repository.ImportArchive(contents)
	if err != nil {
		var repositoryError themerepo.Error
		if errors.As(err, &repositoryError) {
			return nil, commandError{code: repositoryError.Code, message: repositoryError.Message}
		}
		return nil, commandError{code: "STUDIO_IMPORT_INVALID", message: "Theme archive could not be imported"}
	}
	return map[string]any{"theme": ref}, nil
}

func runRuntimeThemeCommand(arguments []string) (any, error) {
	command, err := parseRuntimeThemeCommand(arguments)
	if err != nil {
		return nil, err
	}
	if command.dataRoot == "" {
		command.dataRoot, err = defaultDataRoot()
		if err != nil {
			return nil, commandError{code: "RUNTIME_CONTROL_UNAVAILABLE", message: "Runtime data root is unavailable"}
		}
	}
	installRoot, err := findInstallRoot(false)
	if err != nil {
		return nil, commandError{code: "THEME_NOT_FOUND", message: "Installed themes are unavailable"}
	}
	repository, err := themerepo.OpenWithPersonal(
		filepath.Join(installRoot, "themes"),
		filepath.Join(command.dataRoot, "theme-store"),
	)
	if err != nil {
		return nil, commandError{code: "RUNTIME_ENVIRONMENT_INVALID", message: "Runtime theme repository is unavailable"}
	}
	return executeRuntimeThemeCommand(command, repository)
}

func runRuntimeCLI(ctx context.Context, arguments []string) (any, error) {
	if len(arguments) == 0 {
		return nil, commandError{code: "CLI_ARGUMENT_INVALID", message: "runtime command is required"}
	}
	if arguments[0] == "list-themes" || arguments[0] == "import" {
		return runRuntimeThemeCommand(arguments)
	}
	response, err := runRuntime(ctx, arguments)
	if err != nil {
		return nil, err
	}
	return runtimeCLIControlResult(response)
}

func runtimeCLIControlResult(response control.Response) (any, error) {
	if !response.OK {
		if response.Error == nil {
			return nil, commandError{code: "RUNTIME_CONTROL_UNAVAILABLE", message: "Runtime returned an invalid rejection"}
		}
		return nil, commandError{
			code: response.Error.Code, message: response.Error.Message, nextAction: response.Error.NextAction,
		}
	}
	var result any
	if len(response.Result) == 0 || json.Unmarshal(response.Result, &result) != nil {
		return nil, commandError{code: "RUNTIME_CONTROL_UNAVAILABLE", message: "Runtime returned an invalid result"}
	}
	return result, nil
}

func stoppedRuntimeResponse(requestID string) (control.Response, error) {
	result, err := json.Marshal(map[string]any{
		"status": "stopped", "controllerAvailable": false,
		"selectedTheme": nil, "appliedTheme": nil, "skinApplied": nil,
		"packageVersion": nil, "operation": nil,
		"nextAction": "Open a saved theme and apply it to start Runtime.",
	})
	if err != nil {
		return control.Response{}, err
	}
	return control.Response{ProtocolVersion: control.ProtocolVersion, RequestID: requestID, OK: true, Result: result}, nil
}

func validateUnversionedRuntimeTheme(themeID string, builtins []themerepo.Ref) error {
	for _, builtin := range builtins {
		if builtin.ID == themeID {
			return nil
		}
	}
	return commandError{code: "THEME_NOT_FOUND", message: "Personal themes require an exact --version"}
}

func validateRuntimeThemeSelection(themeID, themeVersion string) error {
	if themeVersion != "" {
		return nil
	}
	installRoot, err := findInstallRoot(false)
	if err != nil {
		return commandError{code: "THEME_NOT_FOUND", message: "Installed themes are unavailable"}
	}
	repository, err := themerepo.Open(filepath.Join(installRoot, "themes"))
	if err != nil {
		return commandError{code: "THEME_NOT_FOUND", message: "Installed themes are unavailable"}
	}
	builtins, err := repository.BuiltinRefs()
	if err != nil {
		return commandError{code: "THEME_NOT_FOUND", message: "Installed theme catalog is unavailable"}
	}
	return validateUnversionedRuntimeTheme(themeID, builtins)
}

func runRuntime(ctx context.Context, arguments []string) (control.Response, error) {
	if len(arguments) == 0 {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "runtime command is required"}
	}
	commandName := arguments[0]
	switch commandName {
	case "launch", "status", "switch", "pause", "resume", "restore":
	default:
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown runtime command: " + commandName}
	}
	dataRoot, themeID, themeVersion := "", "", ""
	themeProvided, themeVersionProvided := false, false
	for index := 1; index < len(arguments); index++ {
		switch arguments[index] {
		case "--data-root":
			index++
			if index >= len(arguments) {
				return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--data-root requires a value"}
			}
			dataRoot = arguments[index]
		case "--theme":
			index++
			if index >= len(arguments) {
				return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme requires a value"}
			}
			themeID = arguments[index]
			themeProvided = true
		case "--theme-version", "--version":
			if themeVersionProvided {
				return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "theme version may be specified only once"}
			}
			index++
			if index >= len(arguments) {
				return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "theme version requires a value"}
			}
			themeVersion = arguments[index]
			themeVersionProvided = true
		default:
			return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown runtime option: " + arguments[index]}
		}
	}
	if themeVersionProvided && themeVersion == "" {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme-version requires a value"}
	}
	if dataRoot == "" {
		var err error
		dataRoot, err = defaultDataRoot()
		if err != nil {
			return control.Response{}, commandError{code: "RUNTIME_CONTROL_UNAVAILABLE", message: "Runtime data root is unavailable"}
		}
	}
	themeCommand := commandName == "launch" || commandName == "switch"
	if themeCommand && !themeProvided {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme is required for launch and switch"}
	}
	if !themeCommand && (themeProvided || themeVersionProvided) {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "theme options are valid only for launch and switch"}
	}
	if themeCommand {
		if err := validateRuntimeThemeSelection(themeID, themeVersion); err != nil {
			return control.Response{}, err
		}
	}
	id, err := requestID()
	if err != nil {
		return control.Response{}, err
	}
	params, err := json.Marshal(map[string]string{"themeId": themeID, "themeVersion": themeVersion})
	if err != nil {
		return control.Response{}, err
	}
	if commandName == "status" || commandName == "pause" || commandName == "resume" || commandName == "restore" {
		params = json.RawMessage(`{}`)
	}
	request := control.Request{ProtocolVersion: 1, RequestID: id, Command: commandName, Params: params}
	response, err := sendRuntime(ctx, dataRoot, request)
	if err == nil {
		return response, nil
	}
	if commandName == "status" {
		if errors.Is(err, os.ErrNotExist) {
			return stoppedRuntimeResponse(id)
		}
		return control.Response{}, commandError{
			code: "RUNTIME_CONTROL_UNAVAILABLE", message: "Runtime controller status could not be read",
		}
	}
	executable, executableErr := os.Executable()
	if executableErr != nil {
		return control.Response{}, executableErr
	}
	if err := startDetachedController(ctx, executable, dataRoot); err != nil {
		return control.Response{}, err
	}
	return sendRuntime(ctx, dataRoot, request)
}
