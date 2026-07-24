package control

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
)

type Connection = net.Conn

func readFrame(connection net.Conn) ([]byte, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(connection, header); err != nil {
		return nil, err
	}
	length := int(binary.LittleEndian.Uint32(header))
	if length < 1 || length > MaxFrameBytes {
		return nil, errors.New("control frame length is invalid")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(connection, payload); err != nil {
		return nil, err
	}
	return append(header, payload...), nil
}

func ServeOne(ctx context.Context, listener net.Listener, dispatcher *Dispatcher) error {
	connection, err := listener.Accept()
	if err != nil {
		return err
	}
	return ServeConnection(ctx, connection, dispatcher)
}

func ServeConnection(ctx context.Context, connection net.Conn, dispatcher *Dispatcher) error {
	defer connection.Close()
	frame, err := readFrame(connection)
	if err != nil {
		return err
	}
	request, err := DecodeRequest(frame)
	if err != nil {
		return err
	}
	response := dispatcher.Dispatch(ctx, request)
	encoded, err := EncodeFrame(response)
	if err != nil {
		return err
	}
	_, err = connection.Write(encoded)
	return err
}

func Serve(
	ctx context.Context,
	listener net.Listener,
	dispatcher *Dispatcher,
	afterResponse func(),
) error {
	var handlers sync.WaitGroup
	serveErrors := make(chan error, 1)
	stopContextWatch := make(chan struct{})
	defer close(stopContextWatch)
	go func() {
		select {
		case <-ctx.Done():
			_ = listener.Close()
		case <-stopContextWatch:
		}
	}()
	for {
		connection, err := listener.Accept()
		if err != nil {
			handlers.Wait()
			select {
			case serveErr := <-serveErrors:
				return serveErr
			default:
			}
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		handlers.Add(1)
		go func() {
			defer handlers.Done()
			if err := ServeConnection(ctx, connection, dispatcher); err != nil {
				select {
				case serveErrors <- err:
				default:
				}
				_ = listener.Close()
				return
			}
			if afterResponse != nil {
				afterResponse()
			}
		}()
	}
}

func RoundTrip(
	ctx context.Context,
	dial func() (Connection, error),
	request Request,
) (Response, error) {
	connection, err := dial()
	if err != nil {
		return Response{}, err
	}
	defer connection.Close()
	if deadline, ok := ctx.Deadline(); ok {
		if err := connection.SetDeadline(deadline); err != nil {
			return Response{}, err
		}
	}
	frame, err := EncodeFrame(request)
	if err != nil {
		return Response{}, err
	}
	if _, err := connection.Write(frame); err != nil {
		return Response{}, err
	}
	responseFrame, err := readFrame(connection)
	if err != nil {
		return Response{}, err
	}
	return DecodeResponse(responseFrame)
}
