package http_api

import (
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/internal/middleware"
	"github.com/mattrax/Mattrax/mdm"
	"golang.org/x/crypto/bcrypt"
)

func SettingsOverview(srv *mattrax.Server) http.HandlerFunc {
	type Response struct {
		DebugMode      bool                   `json:"debug_mode"`
		CloudMode      bool                   `json:"cloud_mode"`
		PrimaryDomain  string                 `json:"primary_domain"`
		DatabaseStatus bool                   `json:"database_status"`
		ZipkinStatus   bool                   `json:"zipkin_status,omitempty"`
		Protocols      map[string]interface{} `json:"protocols"`
		Version        string                 `json:"version"`
		VersionCommit  string                 `json:"version_commit"`
		VersionDate    string                 `json:"version_date"`
	}

	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			var cmd = Response{
				DebugMode:      srv.Args.Debug,
				CloudMode:      srv.Args.MattraxCloud,
				PrimaryDomain:  srv.Args.Domain,
				DatabaseStatus: srv.DBConn.PingContext(r.Context()) == nil,
				ZipkinStatus:   srv.Args.Zipkin != "",
				Protocols:      map[string]interface{}{},
				Version:        mattrax.Version,
				VersionCommit:  mattrax.VersionCommit,
				VersionDate:    mattrax.VersionDate,
			}

			for _, p := range mdm.Protocols {
				status, err := p.Status()
				if err != nil {
					return nil, fmt.Errorf("error checking status of protocol '%s': %w", p.ID(), err)
				}

				cmd.Protocols[p.ID()] = status
			}

			return cmd, nil
		},
	}.Handler(srv.DB)
}

func SettingsTenant(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			tenant, err := DB.GetTenant(r.Context(), vars["tenant"])
			if err != nil {
				return nil, fmt.Errorf("error getting tenant: %w", err)
			}

			domains, err := DB.GetTenantDomains(r.Context(), vars["tenant"])
			if err != nil {
				return nil, fmt.Errorf("error getting tenant domains: %w", err)
			}

			return map[string]interface{}{
				"tenant":  tenant,
				"domains": domains,
			}, nil
		},
		PatchType: func(r *http.Request) interface{} {
			return &db.Tenant{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			policy, ok := cmd.(*db.Tenant)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			err := DB.UpdateTenant(r.Context(), db.UpdateTenantParams{
				ID:          vars["tenant"],
				DisplayName: policy.DisplayName,
				Email:       policy.Email,
				Phone:       policy.Phone,
			})

			return nil, err
		},
	}.Handler(srv.DB)
}

func SettingsMe(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			claims := middleware.AuthClaimsFromContext(r.Context())
			if claims == nil {
				// TODO: w.WriteHeader(http.StatusUnauthorized)
				return nil, fmt.Errorf("authentication claims are not on the request. Developer caused bug")
			}

			return DB.GetUser(r.Context(), claims.Subject)
		},
		PatchType: func(r *http.Request) interface{} {
			return &db.User{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			user, ok := cmd.(*db.User)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			claims := middleware.AuthClaimsFromContext(r.Context())
			if claims == nil {
				// TODO: w.WriteHeader(http.StatusUnauthorized)
				return nil, fmt.Errorf("authentication claims are not on the request. Developer caused bug")
			}

			if user.Password.Valid {
				passwordHash, err := bcrypt.GenerateFromPassword([]byte(user.Password.String), 15)
				if err != nil {
					return nil, fmt.Errorf("error generating bcrypt hash of users new password: %w", err)
				}
				user.Password.String = string(passwordHash)

				user.PasswordExpiry = sql.NullTime{
					Time:  time.Now().Add(time.Hour * 24 * 365 * 10 /* 10 Years */),
					Valid: true,
				}
			}

			err := DB.UpdateUser(r.Context(), db.UpdateUserParams{
				UPN:            claims.Subject,
				Fullname:       user.Fullname,
				Password:       user.Password,
				PasswordExpiry: user.PasswordExpiry,
			})

			return nil, err
		},
	}.Handler(srv.DB)
}
