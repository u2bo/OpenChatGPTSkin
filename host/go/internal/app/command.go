package app

import (
	"errors"
	"fmt"
)

type Role string

const (
	RoleStudio     Role = "studio"
	RoleController Role = "controller"
	RoleRuntime    Role = "runtime"
	RoleContract   Role = "contract-baseline"
)

type Command struct {
	Role Role
	Args []string
}

type commandError struct {
	code    string
	message string
}

func (err commandError) Error() string { return err.message }

func ErrorCode(err error) string {
	var value commandError
	if errors.As(err, &value) {
		return value.code
	}
	return "INTERNAL"
}

func Parse(arguments []string) (Command, error) {
	if len(arguments) == 0 {
		return Command{Role: RoleStudio}, nil
	}
	role := Role(arguments[0])
	switch role {
	case RoleStudio, RoleController, RoleRuntime, RoleContract:
		return Command{Role: role, Args: append([]string(nil), arguments[1:]...)}, nil
	default:
		return Command{}, commandError{code: "CLI_ARGUMENT_INVALID", message: fmt.Sprintf("unknown role: %s", arguments[0])}
	}
}
