package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themecli"
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

type studioOptions struct {
	healthOnce bool
	noOpen     bool
	dev        bool
	viteOrigin string
}

func parseStudioOptions(arguments []string) (studioOptions, error) {
	options := studioOptions{}
	for index := 0; index < len(arguments); index++ {
		switch arguments[index] {
		case "--health-once":
			options.healthOnce = true
		case "--no-open":
			options.noOpen = true
		case "--dev":
			if options.dev {
				return studioOptions{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--dev may be specified only once"}
			}
			options.dev = true
		case "--vite-origin":
			index++
			if index >= len(arguments) || !options.dev || options.viteOrigin != "" {
				return studioOptions{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--vite-origin requires --dev and a value"}
			}
			options.viteOrigin = arguments[index]
		default:
			return studioOptions{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown studio option: " + arguments[index]}
		}
	}
	if options.dev && options.viteOrigin == "" {
		return studioOptions{}, commandError{code: "CLI_ARGUMENT_INVALID", message: "--dev requires --vite-origin"}
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
		options, parseErr := parseStudioOptions(command.Args)
		if parseErr != nil {
			writeCLIError(stderr, parseErr)
			return 2
		}
		start := StartStudio
		if options.viteOrigin != "" {
			start = func(context context.Context) (*RunningStudio, error) {
				return StartStudioDev(context, options.viteOrigin)
			}
		}
		studio, startErr := start(ctx)
		if startErr != nil {
			writeCLIError(stderr, startErr)
			return 1
		}
		result := map[string]any{"ok": true, "role": "studio"}
		if options.noOpen {
			result["url"] = studio.BootstrapURL
		}
		_ = json.NewEncoder(stdout).Encode(result)
		if options.healthOnce {
			_ = studio.Close()
			return 0
		}
		if !options.noOpen {
			if err := openBrowser(studio.BootstrapURL); err != nil {
				_ = studio.Close()
				writeCLIError(stderr, commandError{code: "STUDIO_START_FAILED", message: "Studio browser could not be opened"})
				return 1
			}
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
		response, runtimeErr := runRuntimeCLI(ctx, command.Args)
		if runtimeErr != nil {
			writeCLIError(stderr, runtimeErr)
			return 1
		}
		_ = json.NewEncoder(stdout).Encode(response)
		return 0
	case RoleTheme:
		result, themeErr := themecli.Execute(command.Args)
		if themeErr != nil {
			writeThemeCLIError(stderr, themeErr)
			if themecli.IsUsage(themeErr) {
				return 2
			}
			return 1
		}
		_ = json.NewEncoder(stdout).Encode(result)
		return 0
	case RoleContract:
		result, contractErr := runContractBaseline(ctx, command.Args)
		if contractErr != nil {
			writeCLIError(stderr, contractErr)
			return 1
		}
		_ = json.NewEncoder(stdout).Encode(result)
		return 0
	default:
		writeCLIError(stderr, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown role"})
		return 2
	}
}

func writeThemeCLIError(writer io.Writer, err error) {
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"error": map[string]string{"code": themecli.ErrorCode(err), "message": err.Error()},
	})
}

func writeCLIError(writer io.Writer, err error) {
	value := map[string]string{"code": ErrorCode(err), "message": err.Error()}
	var command commandError
	if errors.As(err, &command) && command.nextAction != "" {
		value["nextAction"] = command.nextAction
	}
	_ = json.NewEncoder(writer).Encode(map[string]any{"error": value})
}

func Main(arguments []string, stdout, stderr io.Writer) int {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return Run(ctx, arguments, stdout, stderr)
}
