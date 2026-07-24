package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"sync"
)

type RunningStudio struct {
	Origin string
	server *http.Server
	once   sync.Once
}

func StartStudio(_ context.Context) (*RunningStudio, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			response.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"ok": true, "role": "studio"})
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5_000_000_000}
	running := &RunningStudio{Origin: "http://" + listener.Addr().String(), server: server}
	go func() { _ = server.Serve(listener) }()
	return running, nil
}

func (studio *RunningStudio) Close() error {
	var err error
	studio.once.Do(func() { err = studio.server.Close() })
	return err
}
