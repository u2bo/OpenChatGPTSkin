package image

import (
	"bytes"
	"encoding/binary"
	stdimage "image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/gen2brain/webp"
)

func sourcePNG(t *testing.T) []byte {
	t.Helper()
	value := stdimage.NewNRGBA(stdimage.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			value.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 50), G: uint8(y * 80), B: 120, A: 255})
		}
	}
	value.SetNRGBA(1, 1, color.NRGBA{R: 255, A: 0})
	var output bytes.Buffer
	if err := png.Encode(&output, value); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestPipelinePreservesAlphaCropsResizesAndEncodesWebP(t *testing.T) {
	output, err := Process(sourcePNG(t), Options{Width: 2, Height: 2, Lossless: true})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := webp.Decode(bytes.NewReader(output))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 2 || decoded.Bounds().Dy() != 2 {
		t.Fatalf("bounds = %v", decoded.Bounds())
	}
	_, _, _, alpha := decoded.At(0, 1).RGBA()
	if alpha == 0xffff {
		t.Fatal("alpha channel was flattened")
	}
}

func TestPipelineSupportsInsideWithoutUpscaling(t *testing.T) {
	output, err := Process(sourcePNG(t), Options{Width: 2400, Height: 1350, Fit: FitInside, NoUpscale: true, Lossless: true})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := webp.Decode(bytes.NewReader(output))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 4 || decoded.Bounds().Dy() != 2 {
		t.Fatalf("inside image was enlarged: %v", decoded.Bounds())
	}
}

func TestPipelineAppliesJPEGExifOrientation(t *testing.T) {
	value := stdimage.NewNRGBA(stdimage.Rect(0, 0, 2, 1))
	value.Set(0, 0, color.RGBA{R: 255, A: 255})
	value.Set(1, 0, color.RGBA{B: 255, A: 255})
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, value, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatal(err)
	}
	oriented := injectExifOrientation(encoded.Bytes(), 6)
	output, err := Process(oriented, Options{Lossless: true})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := webp.Decode(bytes.NewReader(output))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 1 || decoded.Bounds().Dy() != 2 {
		t.Fatalf("oriented bounds = %v", decoded.Bounds())
	}
}

func injectExifOrientation(jpegBytes []byte, orientation int) []byte {
	tiff := make([]byte, 26)
	copy(tiff[:2], "II")
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 1)
	binary.LittleEndian.PutUint16(tiff[10:12], 0x0112)
	binary.LittleEndian.PutUint16(tiff[12:14], 3)
	binary.LittleEndian.PutUint32(tiff[14:18], 1)
	binary.LittleEndian.PutUint16(tiff[18:20], uint16(orientation))
	segment := append([]byte("Exif\x00\x00"), tiff...)
	header := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(header[2:], uint16(len(segment)+2))
	result := make([]byte, 0, len(jpegBytes)+len(header)+len(segment))
	result = append(result, jpegBytes[:2]...)
	result = append(result, header...)
	result = append(result, segment...)
	result = append(result, jpegBytes[2:]...)
	return result
}

func TestPipelineRejectsCorruptionAndLimits(t *testing.T) {
	if _, err := Process([]byte("not an image"), Options{}); ErrorCode(err) != "IMAGE_DECODE_INVALID" {
		t.Fatalf("corrupt error = %v", err)
	}
	if _, err := Process(sourcePNG(t), Options{MaxInputBytes: 2}); ErrorCode(err) != "IMAGE_INPUT_TOO_LARGE" {
		t.Fatalf("limit error = %v", err)
	}
	if _, err := Process(sourcePNG(t), Options{Width: math.MaxInt, Height: 2}); ErrorCode(err) != "IMAGE_DIMENSIONS_INVALID" {
		t.Fatalf("overflowing dimensions error = %v", err)
	}
}

func TestInputLimitCanOnlyBeTightened(t *testing.T) {
	if got := inputLimit(defaultMaxInputBytes + 1); got != defaultMaxInputBytes {
		t.Fatalf("raised input limit = %d", got)
	}
	if got := inputLimit(1024); got != 1024 {
		t.Fatalf("tightened input limit = %d", got)
	}
}

func TestProcessFileRejectsOversizedInputBeforeReplacingOutput(t *testing.T) {
	directory := t.TempDir()
	input := filepath.Join(directory, "input.png")
	output := filepath.Join(directory, "output.webp")
	if err := os.WriteFile(input, sourcePNG(t), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ProcessFile(input, output, Options{MaxInputBytes: 2}); ErrorCode(err) != "IMAGE_INPUT_TOO_LARGE" {
		t.Fatalf("limit error = %v", err)
	}
	contents, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "original" {
		t.Fatalf("oversized input changed output: %q", contents)
	}
}

func TestProcessFileFailsAtomically(t *testing.T) {
	directory := t.TempDir()
	input := filepath.Join(directory, "invalid.bin")
	output := filepath.Join(directory, "output.webp")
	if err := os.WriteFile(input, []byte("invalid"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ProcessFile(input, output, Options{}); err == nil {
		t.Fatal("invalid source unexpectedly succeeded")
	}
	contents, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "original" {
		t.Fatalf("atomic failure changed output: %q", contents)
	}
}

func TestProcessFileAtomicallyReplacesExistingOutput(t *testing.T) {
	directory := t.TempDir()
	input := filepath.Join(directory, "input.png")
	output := filepath.Join(directory, "output.webp")
	if err := os.WriteFile(input, sourcePNG(t), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ProcessFile(input, output, Options{Width: 2, Height: 2, Lossless: true}); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) == "old" {
		t.Fatal("successful image processing did not replace the old output")
	}
	if _, err := webp.Decode(bytes.NewReader(contents)); err != nil {
		t.Fatalf("replacement is not WebP: %v", err)
	}
}
