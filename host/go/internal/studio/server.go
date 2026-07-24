package studio

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

const (
	cspNoncePlaceholder = "__OPEN_CHATGPT_SKIN_CSP_NONCE__"
	sessionCookieName   = "ocs_studio_session"
	sessionLimitBytes   = 16 * 1024
	jsonLimitBytes      = 256 * 1024
	eventInterval       = 5 * time.Second
)

type RuntimeStatus struct {
	Status              string         `json:"status"`
	ControllerAvailable bool           `json:"controllerAvailable"`
	SelectedTheme       *themerepo.Ref `json:"selectedTheme"`
	AppliedTheme        *themerepo.Ref `json:"appliedTheme"`
	SkinApplied         *bool          `json:"skinApplied"`
	PackageVersion      *string        `json:"packageVersion"`
	Operation           *string        `json:"operation"`
	NextAction          string         `json:"nextAction"`
}

func StoppedRuntimeStatus() RuntimeStatus {
	return RuntimeStatus{
		Status: "stopped", NextAction: "Open a saved theme and apply it to start Runtime.",
	}
}

type Config struct {
	IndexHTML     []byte
	ThemeRoot     string
	StudioVersion string
	RepositoryURL *string
	RuntimeStatus func() RuntimeStatus
	MaxSSEClients int
	ViteOrigin    string
}

type RunningServer struct {
	Origin       string
	BootstrapURL string
	server       *http.Server
	listener     net.Listener
	closeOnce    sync.Once
	closeErr     error
}

type studioError struct {
	code       string
	message    string
	statusCode int
}

func (err studioError) Error() string { return err.message }

func ErrorCode(err error) string {
	var value studioError
	if errors.As(err, &value) {
		return value.code
	}
	return ""
}

type session struct {
	bootstrap string
	available bool
	value     string
	mu        sync.Mutex
}

func newToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func newSession() (*session, error) {
	token, err := newToken()
	if err != nil {
		return nil, err
	}
	return &session{bootstrap: token, available: true}, nil
}

func (session *session) exchange(token string) (string, error) {
	session.mu.Lock()
	defer session.mu.Unlock()
	if !session.available || !sameToken(token, session.bootstrap) {
		return "", studioError{code: "STUDIO_SESSION_INVALID", message: "Bootstrap token is invalid or already used", statusCode: http.StatusUnauthorized}
	}
	value, err := newToken()
	if err != nil {
		return "", err
	}
	session.available = false
	session.value = value
	return value, nil
}

func (session *session) validCookie(header string) bool {
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.value == "" {
		return false
	}
	for _, part := range strings.Split(header, ";") {
		name, value, found := strings.Cut(strings.TrimSpace(part), "=")
		if found && name == sessionCookieName && sameToken(value, session.value) {
			return true
		}
	}
	return false
}

func sameToken(left, right string) bool {
	if len(left) != 64 || len(right) != 64 {
		return false
	}
	leftBytes, leftErr := hex.DecodeString(left)
	rightBytes, rightErr := hex.DecodeString(right)
	return leftErr == nil && rightErr == nil && subtle.ConstantTimeCompare(leftBytes, rightBytes) == 1
}

func Start(ctx context.Context, config Config) (*RunningServer, error) {
	if config.ViteOrigin == "" && (len(config.IndexHTML) == 0 ||
		!strings.Contains(string(config.IndexHTML), cspNoncePlaceholder) ||
		strings.Count(string(config.IndexHTML), `property="csp-nonce"`) != 1) {
		return nil, studioError{code: "INTERNAL", message: "Production Theme Studio is missing its CSP nonce metadata", statusCode: http.StatusInternalServerError}
	}
	if config.StudioVersion == "" {
		return nil, studioError{code: "INTERNAL", message: "Studio version is required", statusCode: http.StatusInternalServerError}
	}
	repository, err := themerepo.Open(config.ThemeRoot)
	if err != nil {
		return nil, err
	}
	session, err := newSession()
	if err != nil {
		return nil, err
	}
	nonce, err := newNonce()
	if err != nil {
		return nil, err
	}
	indexHTML := []byte(strings.ReplaceAll(string(config.IndexHTML), cspNoncePlaceholder, nonce))
	var viteProxy *httputil.ReverseProxy
	if config.ViteOrigin != "" {
		viteProxy, err = newViteProxy(config.ViteOrigin, nonce)
		if err != nil {
			return nil, err
		}
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	origin := "http://" + listener.Addr().String()
	maxSSEClients := config.MaxSSEClients
	if maxSSEClients < 1 {
		maxSSEClients = 16
	}
	runtimeStatus := config.RuntimeStatus
	if runtimeStatus == nil {
		runtimeStatus = StoppedRuntimeStatus
	}
	state := &handlerState{
		origin: origin, session: session, repository: repository, indexHTML: indexHTML,
		studioVersion: config.StudioVersion, repositoryURL: config.RepositoryURL,
		runtimeStatus: runtimeStatus, maxSSEClients: maxSSEClients, nonce: nonce, viteProxy: viteProxy,
	}
	server := &http.Server{
		Handler:           state,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	running := &RunningServer{
		Origin: origin, BootstrapURL: origin + "/#bootstrap=" + session.bootstrap,
		server: server, listener: listener,
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			running.closeOnce.Do(func() { running.closeErr = err })
		}
	}()
	go func() {
		<-ctx.Done()
		_ = running.Close()
	}()
	return running, nil
}

func newNonce() (string, error) {
	bytes := make([]byte, 18)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func (server *RunningServer) Close() error {
	server.closeOnce.Do(func() { server.closeErr = server.server.Close() })
	return server.closeErr
}

type handlerState struct {
	origin        string
	session       *session
	repository    *themerepo.Repository
	indexHTML     []byte
	studioVersion string
	repositoryURL *string
	runtimeStatus func() RuntimeStatus
	maxSSEClients int
	nonce         string
	viteProxy     *httputil.ReverseProxy
	mu            sync.Mutex
	eventSequence int64
	activeSSE     int
}

func (state *handlerState) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	state.securityHeaders(response)
	if request.Host != strings.TrimPrefix(state.origin, "http://") {
		state.writeError(response, studioError{code: "STUDIO_ORIGIN_REJECTED", message: "Request host is not authorized", statusCode: http.StatusForbidden})
		return
	}
	if request.URL.Path == "/health" {
		if request.Method != http.MethodGet {
			state.writeError(response, studioError{code: "STUDIO_REQUEST_INVALID", message: "Method is not allowed", statusCode: http.StatusMethodNotAllowed})
			return
		}
		state.writeJSON(response, http.StatusOK, map[string]any{"ok": true, "role": "studio"})
		return
	}
	if request.URL.Path == "/" && request.Method == http.MethodGet {
		if state.viteProxy != nil {
			state.viteProxy.ServeHTTP(response, request)
			return
		}
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write(state.indexHTML)
		return
	}
	if state.viteProxy != nil && !strings.HasPrefix(request.URL.Path, "/api/") {
		state.viteProxy.ServeHTTP(response, request)
		return
	}
	if strings.HasPrefix(request.URL.Path, "/api/") && request.URL.Path != "/api/session" && !state.session.validCookie(request.Header.Get("Cookie")) {
		state.writeError(response, studioError{code: "STUDIO_SESSION_INVALID", message: "Studio session is not authenticated", statusCode: http.StatusUnauthorized})
		return
	}
	if err := state.dispatch(response, request); err != nil {
		state.writeError(response, err)
	}
}

func (state *handlerState) dispatch(response http.ResponseWriter, request *http.Request) error {
	switch {
	case request.URL.Path == "/api/session" && request.Method == http.MethodPost:
		if err := state.requireOrigin(request); err != nil {
			return err
		}
		var input struct {
			Token string `json:"token"`
		}
		if err := decodeBoundedJSON(request.Body, sessionLimitBytes, &input); err != nil {
			return err
		}
		cookie, err := state.session.exchange(input.Token)
		if err != nil {
			return err
		}
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Set-Cookie", sessionCookieName+"="+cookie+"; HttpOnly; SameSite=Strict; Path=/")
		response.WriteHeader(http.StatusNoContent)
		return nil
	case request.URL.Path == "/api/bootstrap" && request.Method == http.MethodGet:
		state.writeJSON(response, http.StatusOK, map[string]any{
			"protocolVersion": 2,
			"studioVersion":   state.studioVersion,
			"repositoryUrl":   state.repositoryURL,
			"capabilities":    []string{"studio-shell", "theme-library"},
			"runtime":         state.runtimeStatus(),
		})
		return nil
	case request.URL.Path == "/api/themes" && request.Method == http.MethodGet:
		library, err := state.repository.List()
		if err != nil {
			return err
		}
		state.writeJSON(response, http.StatusOK, library)
		return nil
	case request.URL.Path == "/api/theme-preview" && request.Method == http.MethodGet:
		asset, err := state.repository.Preview(request.URL.Query().Get("source"), themerepo.Ref{
			ID: request.URL.Query().Get("id"), Version: request.URL.Query().Get("version"),
		})
		if err != nil {
			return err
		}
		state.writeBytes(response, http.StatusOK, asset)
		return nil
	case request.URL.Path == "/api/events" && request.Method == http.MethodGet:
		return state.serveEvents(response, request)
	default:
		return studioError{code: "STUDIO_REQUEST_INVALID", message: "Studio route is unavailable", statusCode: http.StatusNotFound}
	}
}

func (state *handlerState) securityHeaders(response http.ResponseWriter) {
	for name, value := range state.securityHeaderValues() {
		response.Header().Set(name, value)
	}
}

func (state *handlerState) securityHeaderValues() map[string]string {
	websocketOrigin := strings.Replace(state.origin, "http://", "ws://", 1)
	return map[string]string{
		"Content-Security-Policy":    "default-src 'self'; connect-src 'self' " + websocketOrigin + "; img-src 'self' blob:; font-src 'self' blob:; style-src 'self' 'nonce-" + state.nonce + "'; style-src-attr 'unsafe-inline'; script-src 'self' 'nonce-" + state.nonce + "'",
		"Cross-Origin-Opener-Policy": "same-origin",
		"Referrer-Policy":            "no-referrer",
		"X-Content-Type-Options":     "nosniff",
		"X-Frame-Options":            "DENY",
	}
}

func (state *handlerState) requireOrigin(request *http.Request) error {
	if request.Header.Get("Origin") != state.origin {
		return studioError{code: "STUDIO_ORIGIN_REJECTED", message: "Origin is not authorized", statusCode: http.StatusForbidden}
	}
	return nil
}

func decodeBoundedJSON(body io.ReadCloser, limit int64, output any) error {
	defer body.Close()
	contents, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return err
	}
	if int64(len(contents)) > limit {
		return studioError{code: "STUDIO_REQUEST_TOO_LARGE", message: "JSON request exceeds its limit", statusCode: http.StatusRequestEntityTooLarge}
	}
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return studioError{code: "STUDIO_REQUEST_INVALID", message: "Request is not valid JSON", statusCode: http.StatusBadRequest}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return studioError{code: "STUDIO_REQUEST_INVALID", message: "Request has trailing JSON", statusCode: http.StatusBadRequest}
	}
	return nil
}

func newViteProxy(origin, nonce string) (*httputil.ReverseProxy, error) {
	target, err := validateViteOrigin(origin)
	if err != nil {
		return nil, err
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout: 5 * time.Second, KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          8,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	direct := proxy.Director
	proxy.Director = func(request *http.Request) {
		direct(request)
		request.Header.Del("Cookie")
		request.Header.Del("Authorization")
		request.Header.Del("Origin")
		request.Header.Set("Accept-Encoding", "identity")
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/html") {
			return nil
		}
		contents, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
		response.Body.Close()
		if err != nil {
			return err
		}
		if len(contents) > 2*1024*1024 {
			return errors.New("Vite HTML response exceeds its limit")
		}
		if strings.Count(string(contents), `property="csp-nonce"`) != 0 {
			return errors.New("Vite HTML already defines CSP nonce metadata")
		}
		injected := strings.Replace(string(contents), "</head>", `<meta property="csp-nonce" nonce="`+nonce+`"></head>`, 1)
		if injected == string(contents) {
			return errors.New("Vite HTML has no head for CSP nonce metadata")
		}
		response.Body = io.NopCloser(strings.NewReader(injected))
		response.ContentLength = int64(len(injected))
		response.Header.Set("Content-Length", strconv.Itoa(len(injected)))
		return nil
	}
	proxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, _ error) {
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusServiceUnavailable)
		_, _ = response.Write([]byte("<!doctype html><title>Theme Studio development host unavailable</title><p>Vite development server is unavailable.</p>"))
	}
	return proxy, nil
}

func validateViteOrigin(value string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() == "" || parsed.Port() == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return nil, studioError{code: "STUDIO_ORIGIN_REJECTED", message: "Vite origin must be a loopback HTTP origin with a port", statusCode: http.StatusBadRequest}
	}
	if parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		return nil, studioError{code: "STUDIO_ORIGIN_REJECTED", message: "Vite origin must use loopback", statusCode: http.StatusBadRequest}
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, studioError{code: "STUDIO_ORIGIN_REJECTED", message: "Vite origin port is invalid", statusCode: http.StatusBadRequest}
	}
	return parsed, nil
}

func (state *handlerState) writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(status)
	if err := json.NewEncoder(response).Encode(body); err != nil {
		return
	}
}

func (state *handlerState) writeBytes(response http.ResponseWriter, status int, asset themerepo.Asset) {
	response.Header().Set("Content-Type", asset.MIMEType)
	response.Header().Set("Content-Length", strconv.Itoa(len(asset.Bytes)))
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(status)
	_, _ = response.Write(asset.Bytes)
}

func (state *handlerState) writeError(response http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "INTERNAL"
	message := "The Studio request could not be completed."
	var studioErr studioError
	if errors.As(err, &studioErr) {
		status, code, message = studioErr.statusCode, studioErr.code, studioErr.message
	}
	var repositoryErr themerepo.Error
	if errors.As(err, &repositoryErr) {
		status, code, message = http.StatusUnprocessableEntity, repositoryErr.Code, repositoryErr.Message
		if repositoryErr.Code == "THEME_NOT_FOUND" {
			status = http.StatusNotFound
		}
	}
	state.writeJSON(response, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func (state *handlerState) serveEvents(response http.ResponseWriter, request *http.Request) error {
	flusher, ok := response.(http.Flusher)
	if !ok {
		return studioError{code: "INTERNAL", message: "Streaming is unavailable", statusCode: http.StatusInternalServerError}
	}
	state.mu.Lock()
	if state.activeSSE >= state.maxSSEClients {
		state.mu.Unlock()
		return studioError{code: "RUNTIME_STATUS_UNAVAILABLE", message: "Too many Runtime status streams are open", statusCode: http.StatusServiceUnavailable}
	}
	state.activeSSE++
	state.mu.Unlock()
	defer func() {
		state.mu.Lock()
		state.activeSSE--
		state.mu.Unlock()
	}()
	response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Connection", "keep-alive")
	response.WriteHeader(http.StatusOK)
	write := func() error {
		state.mu.Lock()
		state.eventSequence++
		sequence := state.eventSequence
		state.mu.Unlock()
		payload, err := json.Marshal(map[string]any{
			"protocolVersion": 2, "sequence": sequence, "kind": "runtime-status", "runtime": state.runtimeStatus(),
		})
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(response, "data: %s\n\n", payload); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}
	if err := write(); err != nil {
		return nil
	}
	ticker := time.NewTicker(eventInterval)
	defer ticker.Stop()
	for {
		select {
		case <-request.Context().Done():
			return nil
		case <-ticker.C:
			if err := write(); err != nil {
				return nil
			}
		}
	}
}
