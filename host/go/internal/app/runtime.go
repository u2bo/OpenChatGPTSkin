package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
)

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
		case "--theme-version":
			index++
			if index >= len(arguments) {
				return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme-version requires a value"}
			}
			themeVersion = arguments[index]
			themeVersionProvided = true
		default:
			return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown runtime option: " + arguments[index]}
		}
	}
	if dataRoot == "" {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--data-root is required for the spike"}
	}
	themeCommand := commandName == "launch" || commandName == "switch"
	if themeCommand && !themeProvided {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--theme is required for launch and switch"}
	}
	if !themeCommand && (themeProvided || themeVersionProvided) {
		return control.Response{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "theme options are valid only for launch and switch"}
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
	if err == nil || commandName == "status" {
		return response, err
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
