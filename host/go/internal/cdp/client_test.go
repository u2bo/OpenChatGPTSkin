package cdp

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func testEndpoint(t *testing.T, rawURL string) Endpoint {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		t.Fatal(err)
	}
	return Endpoint{Host: parsed.Hostname(), Port: port}
}

func TestDiscoverRejectsCrossPortWebSocketTarget(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(`[{"id":"page","type":"page","title":"Codex","url":"app://-/codex","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/page/page","browserContextId":"newer-chromium-field"}]`))
	}))
	defer server.Close()
	_, err := Discover(context.Background(), testEndpoint(t, server.URL))
	var cdpError Error
	if !errorsAs(err, &cdpError) || cdpError.Code != "CDP_ENDPOINT_UNSAFE" {
		t.Fatalf("error=%v", err)
	}
}

func TestSelectCodexTargetRejectsAmbiguousPages(t *testing.T) {
	_, err := SelectCodexTarget([]Target{
		{Type: "page", URL: "app://-/codex"},
		{Type: "page", URL: "https://chatgpt.com/codex"},
	})
	var cdpError Error
	if !errorsAs(err, &cdpError) || cdpError.Code != "CDP_TARGET_AMBIGUOUS" {
		t.Fatalf("error=%v", err)
	}
}

func TestConnectionEvaluatesOnlyOverVerifiedLoopbackSocket(t *testing.T) {
	var restoreChecks atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/json/list" {
			endpoint := testEndpoint(t, "http://"+request.Host)
			_ = json.NewEncoder(response).Encode([]Target{{
				ID: "page", Type: "page", Title: "Codex", URL: "app://-/codex",
				WebSocketDebuggerURL: "ws://" + endpoint.address() + "/devtools/page/page",
			}})
			return
		}
		if request.URL.Path != "/devtools/page/page" {
			http.NotFound(response, request)
			return
		}
		connection, buffer, err := response.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		key := request.Header.Get("Sec-WebSocket-Key")
		digest := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		_, _ = io.WriteString(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+base64.StdEncoding.EncodeToString(digest[:])+"\r\n\r\n")
		if err := buffer.Flush(); err != nil {
			t.Error(err)
			return
		}
		for {
			payload, readErr := readClientText(buffer)
			if readErr != nil {
				return
			}
			var message struct {
				ID     int64  `json:"id"`
				Method string `json:"method"`
				Params struct {
					Expression string `json:"expression"`
				} `json:"params"`
			}
			if err := json.Unmarshal(payload, &message); err != nil || message.Method != "Runtime.evaluate" {
				t.Errorf("message=%s error=%v", payload, err)
				return
			}
			value := `{"main":true,"navigation":true,"composer":true}`
			if strings.Contains(message.Params.Expression, "__openChatGPTSkinAdapter.source(") {
				value = `"true"`
			} else if strings.Contains(message.Params.Expression, `"validateRestore"`) {
				if restoreChecks.Add(1) > 1 {
					value = "true"
				} else {
					value = "false"
				}
			} else if message.Params.Expression == "true" || len(payload) > 64*1024 || strings.Contains(message.Params.Expression, "__openChatGPTSkinAdapter") {
				value = "true"
			}
			response := []byte(`{"id":` + strconv.FormatInt(message.ID, 10) + `,"result":{"result":{"value":` + value + `}}}`)
			if err := writeServerText(buffer, response); err != nil {
				t.Error(err)
				return
			}
		}
	}))
	defer server.Close()
	endpoint := testEndpoint(t, server.URL)
	targets, err := Discover(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	target, err := SelectCompatibleCodexTarget(context.Background(), endpoint, targets)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := Connect(context.Background(), endpoint, target)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.BootstrapAdapter(context.Background()); err != nil {
		t.Fatal(err)
	}
	value, err := connection.Evaluate(context.Background(), "window.location.href")
	if err != nil || string(value) != `{"main":true,"navigation":true,"composer":true}` {
		t.Fatalf("value=%s error=%v", value, err)
	}
	compatible, err := SelectCompatibleCodexTarget(context.Background(), endpoint, targets)
	if err != nil || compatible.ID != target.ID {
		t.Fatalf("compatible=%+v error=%v", compatible, err)
	}
	if err := connection.ApplyTheme(context.Background(), ThemePayload{
		Document:   json.RawMessage(`{"schemaVersion":4,"id":"mountain-mist","version":"1.3.0"}`),
		Files:      map[string][]byte{"assets/background.webp": []byte("fixture")},
		TotalBytes: 64,
	}); err != nil {
		t.Fatal(err)
	}
	if err := connection.RestoreTheme(context.Background()); err != nil {
		t.Fatal(err)
	}
	if restoreChecks.Load() != 2 {
		t.Fatalf("restore checks=%d, want 2", restoreChecks.Load())
	}
}

func readClientText(reader *bufio.ReadWriter) ([]byte, error) {
	first, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}
	second, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}
	if first != 0x81 || second&0x80 == 0 {
		return nil, io.ErrUnexpectedEOF
	}
	length := int(second & 0x7f)
	if length == 126 {
		left, leftErr := reader.ReadByte()
		right, rightErr := reader.ReadByte()
		if leftErr != nil || rightErr != nil {
			return nil, io.ErrUnexpectedEOF
		}
		length = int(left)<<8 | int(right)
	} else if length == 127 {
		var encoded uint64
		for index := 0; index < 8; index++ {
			value, readErr := reader.ReadByte()
			if readErr != nil {
				return nil, readErr
			}
			encoded = encoded<<8 | uint64(value)
		}
		if encoded > maxMessageBytes {
			return nil, io.ErrShortBuffer
		}
		length = int(encoded)
	}
	mask := make([]byte, 4)
	if _, err := io.ReadFull(reader, mask); err != nil {
		return nil, err
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, err
	}
	for index := range payload {
		payload[index] ^= mask[index%len(mask)]
	}
	return payload, nil
}

func writeServerText(writer *bufio.ReadWriter, payload []byte) error {
	if len(payload) > 65535 {
		return io.ErrShortBuffer
	}
	if _, err := writer.Write([]byte{0x81}); err != nil {
		return err
	}
	if len(payload) <= 125 {
		if _, err := writer.Write([]byte{byte(len(payload))}); err != nil {
			return err
		}
	} else if _, err := writer.Write([]byte{126, byte(len(payload) >> 8), byte(len(payload))}); err != nil {
		return err
	}
	if _, err := writer.Write(payload); err != nil {
		return err
	}
	return writer.Flush()
}

func errorsAs(err error, target *Error) bool {
	if err == nil {
		return false
	}
	value, ok := err.(Error)
	if !ok {
		return false
	}
	*target = value
	return true
}

func TestEndpointRejectsNonLoopback(t *testing.T) {
	err := Endpoint{Host: "localhost", Port: 9222}.validate()
	if err == nil || !strings.Contains(err.Error(), "IPv4 loopback") {
		t.Fatalf("error=%v", err)
	}
}

func TestLiveOfficialCodexCDPProbe(t *testing.T) {
	if os.Getenv("OPENCHATGPTSKIN_LIVE_WINDOWS_TEST") != "1" {
		t.Skip("set OPENCHATGPTSKIN_LIVE_WINDOWS_TEST=1 on a prepared Windows device")
	}
	port, err := strconv.Atoi(os.Getenv("OPENCHATGPTSKIN_CDP_PORT"))
	if err != nil || port < 1 || port > 65535 {
		t.Fatal("OPENCHATGPTSKIN_CDP_PORT must be a valid managed loopback port")
	}
	endpoint := Endpoint{Host: "127.0.0.1", Port: port}
	targets, err := Discover(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	target, err := SelectCompatibleCodexTarget(context.Background(), endpoint, targets)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := Connect(context.Background(), endpoint, target)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	value, err := connection.Evaluate(context.Background(), "window.location.href")
	if err != nil {
		t.Fatal(err)
	}
	var location string
	if err := json.Unmarshal(value, &location); err != nil || !isAllowedCodexURL(location) {
		t.Fatalf("location=%q error=%v", location, err)
	}
}
