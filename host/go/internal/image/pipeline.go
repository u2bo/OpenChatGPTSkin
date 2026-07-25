package image

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	stdimage "image"
	"image/draw"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"

	"github.com/gen2brain/webp"
	xdraw "golang.org/x/image/draw"
)

const (
	defaultMaxInputBytes = 50 * 1024 * 1024
	maxPixels            = 80_000_000
	maxOutputBytes       = 16 * 1024 * 1024
)

type Options struct {
	Width         int
	Height        int
	Quality       int
	Lossless      bool
	Fit           Fit
	NoUpscale     bool
	MaxInputBytes int
}

type Fit string

const (
	FitCover  Fit = "cover"
	FitInside Fit = "inside"
)

type pipelineError struct {
	code string
	err  error
}

func (value pipelineError) Error() string { return value.err.Error() }
func (value pipelineError) Unwrap() error { return value.err }

func ErrorCode(err error) string {
	var value pipelineError
	if errors.As(err, &value) {
		return value.code
	}
	return "INTERNAL"
}

func fail(code, message string) error {
	return pipelineError{code: code, err: errors.New(message)}
}

func isWebP(contents []byte) bool {
	return len(contents) >= 12 && string(contents[:4]) == "RIFF" && string(contents[8:12]) == "WEBP"
}

func dimensionsInvalid(width, height int) bool {
	return width <= 0 || height <= 0 || width > maxPixels/height
}

func inputLimit(configured int) int {
	if configured <= 0 || configured > defaultMaxInputBytes {
		return defaultMaxInputBytes
	}
	return configured
}

func decode(contents []byte) (stdimage.Image, error) {
	if isWebP(contents) {
		config, err := webp.DecodeConfig(bytes.NewReader(contents))
		if err != nil || dimensionsInvalid(config.Width, config.Height) {
			return nil, fail("IMAGE_DECODE_INVALID", "WebP image is invalid or too large")
		}
		value, err := webp.Decode(bytes.NewReader(contents), webp.Options{AutoRotate: true})
		if err != nil {
			return nil, fail("IMAGE_DECODE_INVALID", "WebP image could not be decoded")
		}
		return value, nil
	}
	config, _, err := stdimage.DecodeConfig(bytes.NewReader(contents))
	if err != nil || dimensionsInvalid(config.Width, config.Height) {
		return nil, fail("IMAGE_DECODE_INVALID", "image is invalid or too large")
	}
	value, _, err := stdimage.Decode(bytes.NewReader(contents))
	if err != nil {
		return nil, fail("IMAGE_DECODE_INVALID", "image could not be decoded")
	}
	if orientation := jpegOrientation(contents); orientation > 1 {
		value = orient(value, orientation)
	}
	return value, nil
}

func toNRGBA(source stdimage.Image) *stdimage.NRGBA {
	bounds := source.Bounds()
	result := stdimage.NewNRGBA(stdimage.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(result, result.Bounds(), source, bounds.Min, draw.Src)
	return result
}

func orient(source stdimage.Image, orientation int) stdimage.Image {
	src := toNRGBA(source)
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	dw, dh := w, h
	if orientation >= 5 && orientation <= 8 {
		dw, dh = h, w
	}
	dst := stdimage.NewNRGBA(stdimage.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch orientation {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			default:
				dx, dy = x, y
			}
			dst.Set(dx, dy, src.At(x, y))
		}
	}
	return dst
}

func cropAndResize(source stdimage.Image, width, height int, fit Fit, noUpscale bool) (stdimage.Image, error) {
	if width == 0 && height == 0 {
		return source, nil
	}
	if dimensionsInvalid(width, height) {
		return nil, fail("IMAGE_DIMENSIONS_INVALID", "target image dimensions are invalid")
	}
	bounds := source.Bounds()
	sw, sh := bounds.Dx(), bounds.Dy()
	if fit == "" {
		fit = FitCover
	}
	if fit != FitCover && fit != FitInside {
		return nil, fail("IMAGE_DIMENSIONS_INVALID", "image fit is invalid")
	}
	if fit == FitInside {
		scale := min(float64(width)/float64(sw), float64(height)/float64(sh))
		if noUpscale && scale > 1 {
			scale = 1
		}
		outputWidth := max(1, int(float64(sw)*scale+0.5))
		outputHeight := max(1, int(float64(sh)*scale+0.5))
		destination := stdimage.NewNRGBA(stdimage.Rect(0, 0, outputWidth, outputHeight))
		xdraw.CatmullRom.Scale(destination, destination.Bounds(), source, bounds, draw.Over, nil)
		return destination, nil
	}
	targetAspect := float64(width) / float64(height)
	sourceAspect := float64(sw) / float64(sh)
	crop := bounds
	if sourceAspect > targetAspect {
		cropWidth := int(float64(sh) * targetAspect)
		left := bounds.Min.X + (sw-cropWidth)/2
		crop = stdimage.Rect(left, bounds.Min.Y, left+cropWidth, bounds.Max.Y)
	} else if sourceAspect < targetAspect {
		cropHeight := int(float64(sw) / targetAspect)
		top := bounds.Min.Y + (sh-cropHeight)/2
		crop = stdimage.Rect(bounds.Min.X, top, bounds.Max.X, top+cropHeight)
	}
	destination := stdimage.NewNRGBA(stdimage.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(destination, destination.Bounds(), source, crop, draw.Over, nil)
	return destination, nil
}

func Process(contents []byte, options Options) ([]byte, error) {
	limit := inputLimit(options.MaxInputBytes)
	if len(contents) == 0 || len(contents) > limit {
		return nil, fail("IMAGE_INPUT_TOO_LARGE", "image input is empty or exceeds its limit")
	}
	decoded, err := decode(contents)
	if err != nil {
		return nil, err
	}
	processed, err := cropAndResize(decoded, options.Width, options.Height, options.Fit, options.NoUpscale)
	if err != nil {
		return nil, err
	}
	quality := options.Quality
	if quality <= 0 {
		quality = 90
	}
	var output bytes.Buffer
	if err := webp.Encode(&output, processed, webp.Options{
		Quality:  quality,
		Lossless: options.Lossless,
		Method:   4,
		Exact:    true,
	}); err != nil {
		return nil, pipelineError{code: "IMAGE_ENCODE_FAILED", err: fmt.Errorf("encode WebP: %w", err)}
	}
	if output.Len() > maxOutputBytes {
		return nil, fail("IMAGE_OUTPUT_TOO_LARGE", "processed image exceeds its output limit")
	}
	return output.Bytes(), nil
}

func ProcessFile(inputPath, outputPath string, options Options) error {
	limit := inputLimit(options.MaxInputBytes)
	info, err := os.Stat(inputPath)
	if err != nil {
		return err
	}
	if info.Size() <= 0 || info.Size() > int64(limit) {
		return fail("IMAGE_INPUT_TOO_LARGE", "image input is empty or exceeds its limit")
	}
	contents, err := os.ReadFile(inputPath)
	if err != nil {
		return err
	}
	processed, err := Process(contents, options)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(outputPath), ".openchatgptskin-image-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(processed); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := replaceFile(temporaryPath, outputPath); err != nil {
		return err
	}
	committed = true
	return nil
}

func jpegOrientation(contents []byte) int {
	if len(contents) < 4 || contents[0] != 0xff || contents[1] != 0xd8 {
		return 1
	}
	for offset := 2; offset+4 <= len(contents); {
		if contents[offset] != 0xff {
			break
		}
		marker := contents[offset+1]
		if marker == 0xda || marker == 0xd9 {
			break
		}
		length := int(binary.BigEndian.Uint16(contents[offset+2 : offset+4]))
		if length < 2 || offset+2+length > len(contents) {
			break
		}
		segment := contents[offset+4 : offset+2+length]
		if marker == 0xe1 && len(segment) >= 14 && string(segment[:6]) == "Exif\x00\x00" {
			if value := tiffOrientation(segment[6:]); value != 0 {
				return value
			}
		}
		offset += 2 + length
	}
	return 1
}

func tiffOrientation(tiff []byte) int {
	if len(tiff) < 14 {
		return 0
	}
	var order binary.ByteOrder
	if string(tiff[:2]) == "II" {
		order = binary.LittleEndian
	} else if string(tiff[:2]) == "MM" {
		order = binary.BigEndian
	} else {
		return 0
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return 0
	}
	offset := int(order.Uint32(tiff[4:8]))
	if offset < 0 || offset+2 > len(tiff) {
		return 0
	}
	count := int(order.Uint16(tiff[offset : offset+2]))
	for index := 0; index < count; index++ {
		entry := offset + 2 + index*12
		if entry+12 > len(tiff) {
			return 0
		}
		if order.Uint16(tiff[entry:entry+2]) == 0x0112 && order.Uint16(tiff[entry+2:entry+4]) == 3 {
			value := int(order.Uint16(tiff[entry+8 : entry+10]))
			if value >= 1 && value <= 8 {
				return value
			}
		}
	}
	return 0
}
