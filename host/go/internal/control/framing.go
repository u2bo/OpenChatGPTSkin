package control

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
)

const MaxFrameBytes = 64 * 1024

func EncodeFrame(value any) ([]byte, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode control JSON: %w", err)
	}
	if len(payload) == 0 || len(payload) > MaxFrameBytes {
		return nil, errors.New("control frame length is invalid")
	}
	frame := make([]byte, 4+len(payload))
	binary.LittleEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	return frame, nil
}

func decodeFrame(frame []byte, output any) error {
	if len(frame) < 4 || len(frame) > MaxFrameBytes+4 {
		return errors.New("control frame length is invalid")
	}
	length := int(binary.LittleEndian.Uint32(frame[:4]))
	if length < 1 || length > MaxFrameBytes || len(frame) != length+4 {
		return errors.New("control frame is truncated or has trailing data")
	}
	payload := frame[4:]
	if !json.Valid(payload) {
		return errors.New("control JSON is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode control JSON: %w", err)
	}
	return nil
}

func DecodeRequest(frame []byte) (Request, error) {
	var request Request
	if err := decodeFrame(frame, &request); err != nil {
		return Request{}, err
	}
	if err := validateRequest(request); err != nil {
		return Request{}, err
	}
	return request, nil
}

func DecodeResponse(frame []byte) (Response, error) {
	var response Response
	if err := decodeFrame(frame, &response); err != nil {
		return Response{}, err
	}
	if response.ProtocolVersion != ProtocolVersion || response.RequestID == "" {
		return Response{}, errors.New("control response identity is invalid")
	}
	if response.OK == (response.Error != nil) {
		return Response{}, errors.New("control response result is invalid")
	}
	return response, nil
}
