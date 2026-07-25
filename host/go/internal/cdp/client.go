// Package cdp provides the bounded, loopback-only transport used by Runtime.
// It deliberately does not contain ChatGPT DOM or theme logic.
package cdp

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxDiscoveryBytes = 1 << 20
	maxMessageBytes   = 1 << 20
	requestTimeout    = 5 * time.Second
)

type Error struct {
	Code    string
	Message string
}

func (err Error) Error() string { return err.Message }

type Endpoint struct {
	Host string
	Port int
}

type Target struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	Title                string `json:"title"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func (endpoint Endpoint) validate() error {
	if endpoint.Host != "127.0.0.1" || endpoint.Port < 1 || endpoint.Port > 65535 {
		return Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP endpoint must be an IPv4 loopback port"}
	}
	return nil
}

func (endpoint Endpoint) address() string {
	return net.JoinHostPort(endpoint.Host, strconv.Itoa(endpoint.Port))
}

func (endpoint Endpoint) httpClient() *http.Client {
	dialer := &net.Dialer{Timeout: requestTimeout}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if address != endpoint.address() {
				return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP request attempted to leave its verified endpoint"}
			}
			return dialer.DialContext(ctx, "tcp4", address)
		},
		ForceAttemptHTTP2: false,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   requestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP discovery redirects are forbidden"}
		},
	}
}

func Discover(ctx context.Context, endpoint Endpoint) ([]Target, error) {
	if err := endpoint.validate(); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+endpoint.address()+"/json/list", nil)
	if err != nil {
		return nil, err
	}
	response, err := endpoint.httpClient().Do(request)
	if err != nil {
		if typed, ok := err.(Error); ok {
			return nil, typed
		}
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP discovery is unavailable"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, Error{Code: "CDP_NOT_READY", Message: fmt.Sprintf("CDP discovery returned HTTP %d", response.StatusCode)}
	}
	if response.ContentLength > maxDiscoveryBytes {
		return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP discovery response exceeds its limit"}
	}
	contents, err := io.ReadAll(io.LimitReader(response.Body, maxDiscoveryBytes+1))
	if err != nil {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP discovery could not be read"}
	}
	if len(contents) > maxDiscoveryBytes {
		return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP discovery response exceeds its limit"}
	}
	var rawTargets []json.RawMessage
	decoder := json.NewDecoder(strings.NewReader(string(contents)))
	if err := decoder.Decode(&rawTargets); err != nil {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP target list is invalid"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP target list has trailing data"}
	}
	targets := make([]Target, 0, len(rawTargets))
	for _, rawTarget := range rawTargets {
		target, err := decodeTarget(rawTarget)
		if err != nil {
			return nil, err
		}
		if err := validateTarget(target, endpoint); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, nil
}

func decodeTarget(contents json.RawMessage) (Target, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(contents, &fields); err != nil {
		return Target{}, Error{Code: "CDP_NOT_READY", Message: "CDP target is not an object"}
	}
	value := Target{}
	for name, target := range map[string]*string{
		"id": &value.ID, "type": &value.Type, "title": &value.Title, "url": &value.URL,
		"webSocketDebuggerUrl": &value.WebSocketDebuggerURL,
	} {
		contents, present := fields[name]
		if !present || json.Unmarshal(contents, target) != nil || *target == "" {
			return Target{}, Error{Code: "CDP_NOT_READY", Message: "CDP target has an invalid field"}
		}
	}
	return value, nil
}

func SelectCodexTarget(targets []Target) (Target, error) {
	candidates := make([]Target, 0, 1)
	for _, target := range targets {
		if target.Type == "page" && isAllowedCodexURL(target.URL) {
			candidates = append(candidates, target)
		}
	}
	switch len(candidates) {
	case 1:
		return candidates[0], nil
	case 0:
		return Target{}, Error{Code: "CDP_TARGET_NOT_FOUND", Message: "No compatible Codex page target exists"}
	default:
		return Target{}, Error{Code: "CDP_TARGET_AMBIGUOUS", Message: "Multiple compatible Codex page targets exist"}
	}
}

// SelectCompatibleCodexTarget executes the reviewed, generated Adapter probe
// in every otherwise eligible page. This avoids guessing from transient route
// names and keeps all DOM knowledge in the TypeScript Adapter artifact.
func SelectCompatibleCodexTarget(ctx context.Context, endpoint Endpoint, targets []Target) (Target, error) {
	artifact, err := loadAdapterArtifact()
	if err != nil {
		return Target{}, err
	}
	candidates := make([]Target, 0, 1)
	for _, target := range targets {
		if target.Type != "page" || !isAllowedCodexURL(target.URL) {
			continue
		}
		connection, connectErr := Connect(ctx, endpoint, target)
		if connectErr != nil {
			var cdpError Error
			if errors.As(connectErr, &cdpError) && cdpError.Code == "CDP_ENDPOINT_UNSAFE" {
				return Target{}, connectErr
			}
			continue
		}
		result, evaluateErr := connection.Evaluate(ctx, artifact.ProbeExpression)
		closeErr := connection.Close()
		if evaluateErr != nil || closeErr != nil {
			continue
		}
		var probe map[string]bool
		if err := json.Unmarshal(result, &probe); err != nil || !probe["main"] || !probe["navigation"] || !probe["composer"] {
			continue
		}
		candidates = append(candidates, target)
	}
	switch len(candidates) {
	case 1:
		return candidates[0], nil
	case 0:
		return Target{}, Error{Code: "ADAPTER_INCOMPATIBLE", Message: "No compatible Codex page target exists"}
	default:
		return Target{}, Error{Code: "CDP_TARGET_AMBIGUOUS", Message: "Multiple compatible Codex page targets exist"}
	}
}

func isAllowedCodexURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	return parsed.Scheme == "app" || parsed.Scheme == "https" && parsed.Hostname() == "chatgpt.com" && (parsed.Path == "/codex" || strings.HasPrefix(parsed.Path, "/codex/"))
}

func validateTarget(target Target, endpoint Endpoint) error {
	if target.ID == "" || target.Type == "" || target.Title == "" || target.URL == "" || target.WebSocketDebuggerURL == "" {
		return Error{Code: "CDP_NOT_READY", Message: "CDP target has an invalid field"}
	}
	parsed, err := url.Parse(target.WebSocketDebuggerURL)
	if err != nil || parsed.Scheme != "ws" || parsed.Hostname() != endpoint.Host || parsed.Port() != strconv.Itoa(endpoint.Port) || parsed.User != nil || parsed.Fragment != "" {
		return Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP WebSocket URL is not same-port loopback"}
	}
	return nil
}

type Connection struct {
	connection net.Conn
	reader     *bufio.Reader
	writeMu    sync.Mutex
	sequence   int64
}

func Connect(ctx context.Context, endpoint Endpoint, target Target) (*Connection, error) {
	if err := endpoint.validate(); err != nil {
		return nil, err
	}
	if err := validateTarget(target, endpoint); err != nil {
		return nil, err
	}
	parsed, _ := url.Parse(target.WebSocketDebuggerURL)
	dialer := net.Dialer{Timeout: requestTimeout}
	connection, err := dialer.DialContext(ctx, "tcp4", endpoint.address())
	if err != nil {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket connection failed"}
	}
	closeOnError := true
	defer func() {
		if closeOnError {
			_ = connection.Close()
		}
	}()
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	request := strings.Join([]string{
		"GET " + requestURI(parsed) + " HTTP/1.1",
		"Host: " + endpoint.address(),
		"Upgrade: websocket",
		"Connection: Upgrade",
		"Sec-WebSocket-Key: " + key,
		"Sec-WebSocket-Version: 13",
		"",
		"",
	}, "\r\n")
	if err := connection.SetDeadline(time.Now().Add(requestTimeout)); err != nil {
		return nil, err
	}
	if _, err := io.WriteString(connection, request); err != nil {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket handshake failed"}
	}
	reader := bufio.NewReaderSize(connection, maxMessageBytes+4096)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket handshake is invalid"}
	}
	if response.Body != nil {
		_ = response.Body.Close()
	}
	accept := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	if response.StatusCode != http.StatusSwitchingProtocols || !strings.EqualFold(response.Header.Get("Upgrade"), "websocket") || !strings.Contains(strings.ToLower(response.Header.Get("Connection")), "upgrade") || response.Header.Get("Sec-WebSocket-Accept") != base64.StdEncoding.EncodeToString(accept[:]) {
		return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket upgrade was rejected"}
	}
	if err := connection.SetDeadline(time.Time{}); err != nil {
		return nil, err
	}
	closeOnError = false
	return &Connection{connection: connection, reader: reader}, nil
}

func requestURI(value *url.URL) string {
	path := value.EscapedPath()
	if path == "" {
		path = "/"
	}
	if value.RawQuery != "" {
		path += "?" + value.RawQuery
	}
	return path
}

func (connection *Connection) Close() error { return connection.connection.Close() }

func (connection *Connection) Evaluate(ctx context.Context, expression string) (json.RawMessage, error) {
	if expression == "" || len(expression) > maxMessageBytes/2 {
		return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP evaluation expression is invalid"}
	}
	connection.writeMu.Lock()
	defer connection.writeMu.Unlock()
	connection.sequence++
	id := connection.sequence
	payload, err := json.Marshal(map[string]any{
		"id":     id,
		"method": "Runtime.evaluate",
		"params": map[string]any{"expression": expression, "returnByValue": true, "awaitPromise": true},
	})
	if err != nil {
		return nil, err
	}
	if err := connection.writeText(ctx, payload); err != nil {
		return nil, err
	}
	for {
		contents, err := connection.readText(ctx)
		if err != nil {
			return nil, err
		}
		var response struct {
			ID     int64           `json:"id"`
			Error  json.RawMessage `json:"error"`
			Result struct {
				ExceptionDetails json.RawMessage `json:"exceptionDetails"`
				Result           struct {
					Value json.RawMessage `json:"value"`
				} `json:"result"`
			} `json:"result"`
		}
		if err := json.Unmarshal(contents, &response); err != nil {
			return nil, Error{Code: "CDP_NOT_READY", Message: "CDP response is invalid"}
		}
		if response.ID != id {
			continue
		}
		if len(response.Error) != 0 || len(response.Result.ExceptionDetails) != 0 || len(response.Result.Result.Value) == 0 {
			return nil, Error{Code: "ADAPTER_INCOMPATIBLE", Message: "CDP evaluation failed"}
		}
		return append(json.RawMessage(nil), response.Result.Result.Value...), nil
	}
}

func (connection *Connection) writeText(ctx context.Context, payload []byte) error {
	if len(payload) > maxMessageBytes {
		return Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP message exceeds its limit"}
	}
	if err := connection.connection.SetWriteDeadline(deadline(ctx)); err != nil {
		return err
	}
	defer connection.connection.SetWriteDeadline(time.Time{})
	return writeFrame(connection.connection, 0x1, payload)
}

func (connection *Connection) readText(ctx context.Context) ([]byte, error) {
	if err := connection.connection.SetReadDeadline(deadline(ctx)); err != nil {
		return nil, err
	}
	defer connection.connection.SetReadDeadline(time.Time{})
	for {
		opcode, payload, err := readFrame(connection.reader)
		if err != nil {
			return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket is closed"}
		}
		switch opcode {
		case 0x1:
			return payload, nil
		case 0x8:
			return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket closed"}
		case 0x9:
			if err := writeFrame(connection.connection, 0xA, payload); err != nil {
				return nil, Error{Code: "CDP_NOT_READY", Message: "CDP WebSocket ping response failed"}
			}
		case 0xA:
			continue
		default:
			return nil, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP WebSocket frame type is unsupported"}
		}
	}
}

func deadline(ctx context.Context) time.Time {
	if value, ok := ctx.Deadline(); ok {
		return value
	}
	return time.Now().Add(requestTimeout)
}

func writeFrame(writer io.Writer, opcode byte, payload []byte) error {
	if len(payload) > maxMessageBytes {
		return errors.New("frame exceeds its limit")
	}
	if _, err := writer.Write([]byte{0x80 | opcode}); err != nil {
		return err
	}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	length := len(payload)
	switch {
	case length <= 125:
		if _, err := writer.Write([]byte{0x80 | byte(length)}); err != nil {
			return err
		}
	case length <= 65535:
		if _, err := writer.Write([]byte{0x80 | 126, byte(length >> 8), byte(length)}); err != nil {
			return err
		}
	default:
		encoded := uint64(length)
		header := []byte{0x80 | 127, 0, 0, 0, 0, 0, 0, 0, 0}
		for index := len(header) - 1; index >= 1; index-- {
			header[index] = byte(encoded)
			encoded >>= 8
		}
		if _, err := writer.Write(header); err != nil {
			return err
		}
	}
	if _, err := writer.Write(mask); err != nil {
		return err
	}
	masked := append([]byte(nil), payload...)
	for index := range masked {
		masked[index] ^= mask[index%len(mask)]
	}
	_, err := writer.Write(masked)
	return err
}

func readFrame(reader *bufio.Reader) (byte, []byte, error) {
	first, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	second, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	if first&0x80 == 0 || second&0x80 != 0 {
		return 0, nil, errors.New("fragmented or masked server frame")
	}
	length := int(second & 0x7f)
	if length == 126 {
		left, err := reader.ReadByte()
		if err != nil {
			return 0, nil, err
		}
		right, err := reader.ReadByte()
		if err != nil {
			return 0, nil, err
		}
		length = int(left)<<8 | int(right)
	} else if length == 127 {
		var encoded uint64
		for index := 0; index < 8; index++ {
			value, err := reader.ReadByte()
			if err != nil {
				return 0, nil, err
			}
			encoded = encoded<<8 | uint64(value)
		}
		if encoded > maxMessageBytes {
			return 0, nil, errors.New("server frame exceeds its limit")
		}
		length = int(encoded)
	}
	if length > maxMessageBytes {
		return 0, nil, errors.New("server frame exceeds its limit")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return 0, nil, err
	}
	return first & 0x0f, payload, nil
}
