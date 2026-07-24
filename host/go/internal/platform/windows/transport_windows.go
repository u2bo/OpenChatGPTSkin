//go:build windows

package windows

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
	syswindows "golang.org/x/sys/windows"
)

func Endpoint(identity string) string {
	digest := sha256.Sum256([]byte(identity))
	return `\\.\pipe\OpenChatGPTSkin-Go-Spike-` + hex.EncodeToString(digest[:12])
}

func TestEndpoint(identity string) string { return Endpoint(identity) }

func pipeSecurityDescriptor() (string, error) {
	user, err := syswindows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", fmt.Errorf("read current Windows user: %w", err)
	}
	return fmt.Sprintf("D:P(A;;FA;;;SY)(A;;FA;;;%s)", user.User.Sid.String()), nil
}

func securityDescriptorForConnection(connection net.Conn) (*syswindows.SECURITY_DESCRIPTOR, error) {
	handleConnection, ok := connection.(interface{ Fd() uintptr })
	if !ok {
		return nil, errors.New("named pipe connection does not expose its kernel handle")
	}
	actual, err := syswindows.GetSecurityInfo(
		syswindows.Handle(handleConnection.Fd()),
		syswindows.SE_KERNEL_OBJECT,
		syswindows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return nil, fmt.Errorf("read named pipe security: %w", err)
	}
	return actual, nil
}

func verifyPipeSecurity(listener net.Listener, endpoint, expectedDescriptor string) error {
	accepted := make(chan struct {
		connection net.Conn
		err        error
	}, 1)
	go func() {
		connection, err := listener.Accept()
		accepted <- struct {
			connection net.Conn
			err        error
		}{connection: connection, err: err}
	}()
	timeout := 5 * time.Second
	client, err := winio.DialPipe(endpoint, &timeout)
	if err != nil {
		return fmt.Errorf("connect named pipe ACL probe: %w", err)
	}
	defer client.Close()
	server := <-accepted
	if server.err != nil {
		return fmt.Errorf("accept named pipe ACL probe: %w", server.err)
	}
	defer server.connection.Close()
	actual, err := securityDescriptorForConnection(client)
	if err != nil {
		return err
	}
	expected, err := syswindows.SecurityDescriptorFromString(expectedDescriptor)
	if err != nil {
		return fmt.Errorf("parse named pipe security: %w", err)
	}
	if actual.String() != expected.String() {
		return errors.New("named pipe ACL differs from the current user plus SYSTEM policy")
	}
	return nil
}

func Listen(endpoint string) (net.Listener, error) {
	descriptor, err := pipeSecurityDescriptor()
	if err != nil {
		return nil, err
	}
	listener, err := winio.ListenPipe(endpoint, &winio.PipeConfig{
		SecurityDescriptor: descriptor,
		MessageMode:        false,
		InputBufferSize:    64 * 1024,
		OutputBufferSize:   64 * 1024,
	})
	if err != nil {
		return nil, err
	}
	if err := verifyPipeSecurity(listener, endpoint, descriptor); err != nil {
		listener.Close()
		return nil, err
	}
	return listener, nil
}

func Dial(endpoint string) (net.Conn, error) {
	timeout := 5 * time.Second
	return winio.DialPipe(endpoint, &timeout)
}
