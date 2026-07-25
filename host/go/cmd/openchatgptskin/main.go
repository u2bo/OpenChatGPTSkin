package main

import (
	"os"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/app"
)

func main() {
	os.Exit(app.Main(os.Args[1:], os.Stdout, os.Stderr))
}
