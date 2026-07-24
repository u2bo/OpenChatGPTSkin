package control

import "encoding/json"

const ProtocolVersion = 1

type Request struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	Command         string          `json:"command"`
	Params          json.RawMessage `json:"params"`
}

type Result map[string]any

type Error struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	NextAction string `json:"nextAction,omitempty"`
}

type Response struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	OK              bool            `json:"ok"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           *Error          `json:"error,omitempty"`
}
