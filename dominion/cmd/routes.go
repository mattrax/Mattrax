package main

import (
	"log"
	"mime"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"github.com/oscartbeaumont/forge/dominion/internal"
	"github.com/oscartbeaumont/forge/dominion/internal/api"
	"github.com/oscartbeaumont/forge/dominion/internal/azuread"
	"github.com/oscartbeaumont/forge/dominion/internal/certificates"
	"github.com/oscartbeaumont/forge/dominion/internal/handlers"
	"github.com/oscartbeaumont/forge/dominion/pkg/soap"
	"github.com/oscartbeaumont/forge/dominion/pkg/syncml"
)

// routes mounts all of the HTTP handlers onto the router
func routes(mttxAPI api.Service, aadService *azuread.Service, certService *certificates.Service) *mux.Router {
	r := mux.NewRouter()
	r.Use(Middleware)
	if os.Getenv("DEBUG") == "true" {
		r.Use(DebugLoggingMiddleware)
	}

	r.HandleFunc("/", indexHandler).Name("index")
	r.HandleFunc("/EnrollmentServer/TermsOfService.svc", aadTermsofServiceHandler).Name("aad-consent")

	// MDM Handlers
	r.HandleFunc("/ManagementServer/Manage.svc", handlers.Manage(mttxAPI, aadService, certService)).Name("manage").Methods("POST")
	r.HandleFunc("/EnrollmentServer/Policy.svc", handlers.Policy).Name("policy").Methods("POST")
	r.HandleFunc("/EnrollmentServer/Enrollment.svc", handlers.Enrollment(mttxAPI, aadService, certService)).Name("enrollment").Methods("POST")
	r.HandleFunc("/EnrollmentServer/Discovery.svc", handlers.DiscoverGET).Name("discovery").Methods("GET")
	r.HandleFunc("/EnrollmentServer/Discovery.svc", handlers.DiscoverPOST).Name("discovery").Methods("POST")

	// Wrap Router's Fallback Handlers with New Relic
	r.NotFoundHandler = http.NotFoundHandler()
	r.MethodNotAllowedHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte("Method not allowed"))
	})

	return r
}

// indexHandler is the HTTP handler for the root page
func indexHandler(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, internal.IndexWebsite, http.StatusMovedPermanently)
}

// aadTermsofServiceHandler is the terms of service page shown to the user when enrolling using AzureAD authentication.
func aadTermsofServiceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(`<h3>AzureAD Term Of Service</h3><button onClick="acceptBtn()">Accept</button><script>function acceptBtn(){var urlParams=new URLSearchParams(window.location.search);if (!urlParams.has('redirect_uri')){alert('Redirect url not found. Did you open this in your broswer?');}else{window.location=urlParams.get('redirect_uri') + "?IsAccepted=true&OpaqueBlob=TODOCustomDataFromAzureAD";}}</script>`))
}

// Middleware fills the r.URL struct so it can be used by handlers, limits the amount of data
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mediatype, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediatype == "application/soap+xml" {
			r.Body = http.MaxBytesReader(w, r.Body, soap.MaxRequestBodySize)
		} else if mediatype == "application/vnd.syncml.dm+xml" || mediatype == "application/vnd.syncml.dm+wbxml" {
			r.Body = http.MaxBytesReader(w, r.Body, syncml.MaxRequestBodySize)
		} else {
			r.Body = http.MaxBytesReader(w, r.Body, 0)
		}

		if r.TLS != nil {
			r.URL.Scheme = "https"
		} else {
			r.URL.Scheme = "http"
		}
		r.URL.Host = r.Host

		w.Header().Add("X-Content-Type-Options", "nosniff")

		next.ServeHTTP(w, r)
	})
}

// DebugLoggingMiddleware is a middleware that logs each HTTP request. This middleware is only enabled in debug mode.
func DebugLoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Println(r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
