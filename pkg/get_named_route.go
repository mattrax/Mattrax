package pkg

import (
	"fmt"

	"github.com/gorilla/mux"
	"github.com/pkg/errors"
)

// GetNamedRouteURL returns the URL of a handler by name
func GetNamedRouteURL(r *mux.Router, name string, pairs ...string) (string, error) {
	route := r.GetRoute(name)
	if route == nil {
		return "", fmt.Errorf("Error acquiring named route")
	}

	url, err := route.URL(pairs...)
	if err != nil {
		return "", errors.Wrap(err, "Error acquiring url of named route")
	}

	return url.String(), nil
}
