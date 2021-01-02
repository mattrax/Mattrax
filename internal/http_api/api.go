package http_api

import (
	"net/http"
	"regexp"

	"github.com/go-playground/validator/v10"
	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/middleware"
	"github.com/mattrax/Mattrax/mdm"
)

var validate = validator.New()

func init() {
	var alphanumspaceRegex = regexp.MustCompile("^[a-zA-Z0-9 ]+$")
	validate.RegisterValidation("alphanumspace", func(fl validator.FieldLevel) bool {
		return alphanumspaceRegex.MatchString(fl.Field().String())
	})
}

// Mount initialises the API
func Mount(srv *mattrax.Server) {
	r := srv.Router.PathPrefix("/api").Subrouter()
	r.Use(middleware.APIHeaders(srv))
	r.Use(mux.CORSMethodMiddleware(srv.Router)) // TODO: Fix not working + remove temp bypass in API middleware

	r.HandleFunc("/login", Login(srv)).Methods(http.MethodPost, http.MethodOptions).Name("/login")

	rAuthed := r.PathPrefix("/").Subrouter()
	rAuthed.Use(middleware.RequireAuthentication(srv))

	rAuthed.HandleFunc("/me/tenants", Tenants(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodOptions).Name("/me/tenants")
	rAuthed.HandleFunc("/me/settings", SettingsMe(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodOptions).Name("/me/settings")
	rAuthed.HandleFunc("/{tenant}/users", Users(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodOptions).Name("/users")
	rAuthed.HandleFunc("/{tenant}/user/{upn}", User(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodOptions).Name("/user/:upn")
	rAuthed.HandleFunc("/{tenant}/devices", Devices(srv)).Methods(http.MethodGet, http.MethodOptions).Name("/devices")
	rAuthed.HandleFunc("/{tenant}/device/{udid}", Device(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodOptions).Name("/device/:udid")
	rAuthed.HandleFunc("/{tenant}/groups", Groups(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodOptions).Name("/groups")
	rAuthed.HandleFunc("/{tenant}/group/{gid}", Group(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodOptions).Name("/group/:id")
	rAuthed.HandleFunc("/{tenant}/policies", Policies(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodOptions).Name("/policies")
	rAuthed.HandleFunc("/{tenant}/policy/{pid}", Policy(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodOptions).Name("/policy/:id")
	rAuthed.HandleFunc("/{tenant}/applications", Applications(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodOptions).Name("/applications")
	rAuthed.HandleFunc("/{tenant}/application/{aid}", Application(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodOptions).Name("/application/:id")
	rAuthed.HandleFunc("/{tenant}/settings", SettingsTenant(srv)).Methods(http.MethodGet, http.MethodPatch, http.MethodOptions).Name("/:tenant/settings")
	rAuthed.HandleFunc("/settings", SettingsOverview(srv)).Methods(http.MethodGet, http.MethodOptions).Name("/settings")

	// TODO: Still to sort out. Try and merge into above handlers???
	rAuthed.HandleFunc("/{tenant}/device/{udid}/info", DeviceInformation(srv)).Methods(http.MethodGet, http.MethodOptions).Name("/devices/:id/info")
	rAuthed.HandleFunc("/{tenant}/device/{udid}/scope", DeviceScope(srv)).Methods(http.MethodGet, http.MethodOptions).Name("/devices/:id/scope")
	// rAuthed.HandleFunc("/{tenant}/object/{oid}", Object(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodOptions).Name("/object/:id")
	rAuthed.HandleFunc("/{tenant}/group/{gid}/policies", GroupPolicies(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodOptions).Name("/groups/:id/policies")
	rAuthed.HandleFunc("/{tenant}/group/{gid}/devices", GroupDevices(srv)).Methods(http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodOptions).Name("/groups/:id/devices")
	rAuthed.HandleFunc("/{tenant}/policy/{pid}/scope", PolicyScope(srv)).Methods(http.MethodGet, http.MethodOptions).Name("/policy/:id/scope")
	rAuthed.HandleFunc("/{tenant}/domain/{domain}", TenantDomain(srv)).Methods(http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodOptions).Name("/:tenant/domain/:domain")

	for _, p := range mdm.Protocols {
		// TODO: rProtocol := rAuthed.PathPrefix("/" + p.ID()).Subrouter()
		if err := p.MountAPI(rAuthed, r); err != nil {
			panic(err)
		}
	}
}
