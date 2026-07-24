package app

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/signal"
	"syscall"
)

func has(arguments []string, name string) bool {
	for _, argument := range arguments {
		if argument == name {
			return true
		}
	}
	return false
}

func parseControllerOptions(arguments []string) (controllerOptions, error) {
	options := controllerOptions{}
	for index := 0; index < len(arguments); index++ {
		switch arguments[index] {
		case "--once":
			options.once = true
		case "--startup-id", "--startup-file", "--data-root":
			name := arguments[index]
			index++
			if index >= len(arguments) {
				return controllerOptions{}, commandError{code: "CLI_ARGUMENT_INVALID", message: name + " requires a value"}
			}
			switch name {
			case "--startup-id":
				options.startupID = arguments[index]
			case "--startup-file":
				options.startupFile = arguments[index]
			case "--data-root":
				options.dataRoot = arguments[index]
			}
		default:
			return controllerOptions{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown controller option: " + arguments[index]}
		}
	}
	return options, nil
}

func Run(ctx context.Context, arguments []string, stdout, stderr io.Writer) int {
	command, err := Parse(arguments)
	if err != nil {
		writeCLIError(stderr, err)
		return 2
	}
	switch command.Role {
	case RoleStudio:
		if len(command.Args) > 1 || len(command.Args) == 1 && command.Args[0] != "--health-once" && command.Args[0] != "--no-open" {
			writeCLIError(stderr, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown studio option"})
			return 2
		}
		studio, startErr := StartStudio(ctx)
		if startErr != nil {
			writeCLIError(stderr, startErr)
			return 1
		}
		_ = json.NewEncoder(stdout).Encode(map[string]any{"ok": true, "role": "studio", "origin": studio.Origin})
		if has(command.Args, "--health-once") {
			_ = studio.Close()
			return 0
		}
		<-ctx.Done()
		_ = studio.Close()
		return 0
	case RoleController:
		options, parseErr := parseControllerOptions(command.Args)
		if parseErr != nil {
			writeCLIError(stderr, parseErr)
			return 2
		}
		if err := runController(ctx, options); err != nil {
			writeCLIError(stderr, err)
			return 1
		}
		return 0
	case RoleRuntime:
		response, runtimeErr := runRuntime(ctx, command.Args)
		if runtimeErr != nil {
			writeCLIError(stderr, runtimeErr)
			return 1
		}
		_ = json.NewEncoder(stdout).Encode(response)
		return 0
	case RoleContract:
		writeCLIError(stderr, commandError{code: "GO_BASELINE_SUITE_NOT_IMPLEMENTED", message: "The Go feasibility spike does not claim full contract parity"})
		return 1
	default:
		writeCLIError(stderr, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown role"})
		return 2
	}
}

func writeCLIError(writer io.Writer, err error) {
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"error": map[string]string{"code": ErrorCode(err), "message": err.Error()},
	})
}

func Main(arguments []string, stdout, stderr io.Writer) int {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return Run(ctx, arguments, stdout, stderr)
}
