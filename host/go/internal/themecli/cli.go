package themecli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

type cliError struct {
	code    string
	message string
	usage   bool
}

func (err cliError) Error() string { return err.message }

// ErrorCode returns the stable machine-readable code for a theme command error.
func ErrorCode(err error) string {
	if err == nil {
		return ""
	}
	var commandError cliError
	if errors.As(err, &commandError) {
		return commandError.code
	}
	if code := themerepo.ErrorCodeFrom(err); code != "INTERNAL" {
		return code
	}
	return "INTERNAL"
}

// IsUsage reports whether the host should use its command-line usage exit code.
func IsUsage(err error) bool {
	var commandError cliError
	return errors.As(err, &commandError) && commandError.usage
}

func usageError(format string, values ...any) error {
	return cliError{code: "CLI_ARGUMENT_INVALID", message: fmt.Sprintf(format, values...), usage: true}
}

func commandError(code, message string) error {
	return cliError{code: code, message: message}
}

type optionSpec struct {
	required bool
	flag     bool
}

func parseOptions(arguments []string, specs map[string]optionSpec) (map[string]string, map[string]bool, error) {
	values := make(map[string]string, len(specs))
	flags := make(map[string]bool, len(specs))
	seen := make(map[string]struct{}, len(specs))
	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		if strings.ContainsRune(argument, '\x00') || !strings.HasPrefix(argument, "--") {
			return nil, nil, usageError("unexpected argument: %s", argument)
		}
		name := strings.TrimPrefix(argument, "--")
		spec, exists := specs[name]
		if !exists {
			return nil, nil, usageError("unknown option: --%s", name)
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, nil, usageError("--%s may be specified only once", name)
		}
		seen[name] = struct{}{}
		if spec.flag {
			flags[name] = true
			continue
		}
		index++
		if index >= len(arguments) || strings.HasPrefix(arguments[index], "--") || arguments[index] == "" || strings.ContainsRune(arguments[index], '\x00') {
			return nil, nil, usageError("--%s requires a value", name)
		}
		values[name] = arguments[index]
	}
	for name, spec := range specs {
		if spec.required && values[name] == "" && !flags[name] {
			return nil, nil, usageError("--%s is required", name)
		}
	}
	return values, flags, nil
}

func helpResult() map[string]any {
	contract := contractResult()
	return map[string]any{
		"role":            contract["role"],
		"protocolVersion": contract["protocolVersion"],
		"commands":        contract["commands"],
	}
}

func contractResult() map[string]any {
	var result map[string]any
	if err := json.Unmarshal([]byte(themeCLIContractJSON), &result); err != nil {
		panic("generated Theme CLI contract is invalid: " + err.Error())
	}
	return result
}

// Execute runs a machine-readable command in the executable's theme role.
func Execute(arguments []string) (any, error) {
	if len(arguments) == 0 {
		return nil, usageError("theme command is required")
	}
	if strings.ContainsRune(arguments[0], '\x00') {
		return nil, usageError("theme command is invalid")
	}
	command := arguments[0]
	rest := arguments[1:]
	switch command {
	case "contract":
		if len(rest) != 0 {
			return nil, usageError("contract does not accept options")
		}
		return contractResult(), nil
	case "help":
		if len(rest) != 0 {
			return nil, usageError("help does not accept options")
		}
		return helpResult(), nil
	case "create":
		values, _, err := parseOptions(rest, map[string]optionSpec{
			"dir": {required: true}, "id": {required: true}, "name": {required: true}, "author": {required: true},
			"version": {}, "appearance": {}, "background": {},
		})
		if err != nil {
			return nil, err
		}
		appearance := values["appearance"]
		if appearance == "" {
			appearance = "auto"
		}
		if appearance != "auto" && appearance != "light" && appearance != "dark" {
			return nil, usageError("--appearance must be auto, light, or dark")
		}
		version := values["version"]
		if version == "" {
			version = "1.0.0"
		}
		result, err := createProject(createInput{
			directory: values["dir"], id: values["id"], name: values["name"], author: values["author"],
			version: version, appearance: appearance, background: values["background"],
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"created": true, "directory": result.directory, "complete": result.complete, "theme": result.theme,
		}, nil
	case "config":
		values, _, err := parseOptions(rest, map[string]optionSpec{"dir": {required: true}, "patch": {required: true}})
		if err != nil {
			return nil, err
		}
		patch, err := readJSONPatch(values["patch"])
		if err != nil {
			return nil, err
		}
		theme, directory, err := configureProject(values["dir"], patch)
		if err != nil {
			return nil, err
		}
		return map[string]any{"configured": true, "directory": directory, "theme": theme}, nil
	case "show":
		values, _, err := parseOptions(rest, map[string]optionSpec{"dir": {required: true}})
		if err != nil {
			return nil, err
		}
		theme, directory, err := readProject(values["dir"])
		if err != nil {
			return nil, err
		}
		return map[string]any{"directory": directory, "theme": theme}, nil
	case "validate":
		values, flags, err := parseOptions(rest, map[string]optionSpec{"dir": {required: true}, "draft": {flag: true}})
		if err != nil {
			return nil, err
		}
		if flags["draft"] {
			theme, _, err := readProject(values["dir"])
			if err != nil {
				return nil, err
			}
			return map[string]any{"valid": true, "draft": true, "id": theme["id"], "version": theme["version"]}, nil
		}
		bundle, err := themerepo.LoadDirectory(values["dir"])
		if err != nil {
			return nil, err
		}
		totalBytes := len(bundle.Document)
		for _, contents := range bundle.Files {
			totalBytes += len(contents)
		}
		return map[string]any{"valid": true, "draft": false, "id": bundle.Ref.ID, "version": bundle.Ref.Version, "totalBytes": totalBytes}, nil
	case "pack":
		values, _, err := parseOptions(rest, map[string]optionSpec{"dir": {required: true}, "out": {required: true}})
		if err != nil {
			return nil, err
		}
		contents, ref, err := themerepo.PackDirectory(values["dir"])
		if err != nil {
			return nil, err
		}
		output, err := writeNewFile(values["out"], contents)
		if err != nil {
			return nil, err
		}
		return map[string]any{"packed": true, "output": output, "id": ref.ID, "version": ref.Version}, nil
	case "unpack":
		values, _, err := parseOptions(rest, map[string]optionSpec{"file": {required: true}, "out": {required: true}})
		if err != nil {
			return nil, err
		}
		contents, err := readRegularFile(values["file"], maxArchiveBytes, "CLI_READ")
		if err != nil {
			return nil, err
		}
		output, err := filepath.Abs(values["out"])
		if err != nil {
			return nil, commandError("CLI_WRITE", "destination path is invalid")
		}
		ref, err := themerepo.UnpackToDirectory(contents, output)
		if err != nil {
			return nil, err
		}
		return map[string]any{"unpacked": true, "output": output, "id": ref.ID, "version": ref.Version}, nil
	default:
		return nil, usageError("unknown theme command: %s", command)
	}
}

func readRegularFile(path string, limit int64, code string) ([]byte, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, commandError(code, "file path is invalid")
	}
	file, err := os.Open(absolute)
	if err != nil {
		return nil, commandError(code, "file is missing or could not be opened")
	}
	info, statErr := file.Stat()
	if statErr != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > limit {
		_ = file.Close()
		return nil, commandError(code, "file is missing, invalid, or too large")
	}
	contents, readErr := io.ReadAll(io.LimitReader(file, limit+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		return nil, commandError(code, "file could not be read")
	}
	if len(contents) < 1 || int64(len(contents)) > limit {
		return nil, commandError(code, "file is missing, invalid, or too large")
	}
	return contents, nil
}
