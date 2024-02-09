package api

import (
	"net/http"
	"time"

	"github.com/gorilla/schema"
)

// client is a Go HTTP client with a timeout to prevent abuse
var client = &http.Client{
	Timeout:   time.Second * 30,
	Transport: http.DefaultClient.Transport,
}

// encoder is the struct to url Values marshaller
var encoder = schema.NewEncoder()

// Service contains the shared state for the API handlers
type Service struct {
	domain string
}

// New creates a new API service
func New(domain string) Service {
	return Service{domain}
}
