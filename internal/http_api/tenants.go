package http_api

import (
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/internal/middleware"
	"github.com/mattrax/Mattrax/pkg/null"
)

func Tenants(srv *mattrax.Server) http.HandlerFunc {
	// TODO: Use internal type if possible with struct tags
	type Request struct {
		DisplayName   null.String `json:"display_name" validate:"required,alphanumspace,min=1,max=100"`
		PrimaryDomain string      `json:"primary_domain" validate:"required,fqdn,min=1,max=100"`
	}

	type Response struct {
		TenantID string `json:"tenant_id"`
	}

	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			claims := middleware.AuthClaimsFromContext(r.Context())
			if claims == nil {
				// TODO: w.WriteHeader(http.StatusUnauthorized)
				return nil, fmt.Errorf("authentication claims are not on the request. Developer caused bug")
			}

			tenants, err := DB.GetUserTenants(r.Context(), claims.Subject)

			if tenants == nil {
				tenants = make([]db.GetUserTenantsRow, 0)
			}

			return tenants, err
		},
		PostType: func(r *http.Request) interface{} {
			return &Request{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			req, ok := cmd.(*Request)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			claims := middleware.AuthClaimsFromContext(r.Context())
			if claims == nil {
				// TODO: w.WriteHeader(http.StatusUnauthorized)
				return nil, fmt.Errorf("authentication claims are not on the request. Developer caused bug")
			}

			tenantID, err := DB.NewTenant(r.Context(), db.NewTenantParams(*req))
			if err != nil {
				return nil, fmt.Errorf("error creating new tenant: %w", err)
			}

			if err := DB.ScopeUserToTenant(r.Context(), db.ScopeUserToTenantParams{
				UserUpn:         claims.Subject,
				TenantID:        tenantID,
				PermissionLevel: db.UserPermissionLevelAdministrator,
			}); err != nil {
				return nil, fmt.Errorf("error scoping user to new tenant: %w", err)
			}

			if _, err := DB.AddDomainToTenant(r.Context(), db.AddDomainToTenantParams{
				TenantID: tenantID,
				Domain:   req.PrimaryDomain,
			}); err != nil {
				return nil, fmt.Errorf("error adding default domain to tenant: %w", err)
			}

			return Response{
				TenantID: tenantID,
			}, err
		},
	}.Handler(srv.DB)
}

func TenantDomain(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			linkingCode, err := DB.AddDomainToTenant(r.Context(), db.AddDomainToTenantParams{
				Domain:   vars["domain"],
				TenantID: vars["tenant"],
			})

			return db.GetTenantDomainsRow{
				Domain:      vars["domain"],
				LinkingCode: linkingCode,
				Verified:    false,
			}, err
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			domain, err := DB.GetTenantDomain(r.Context(), db.GetTenantDomainParams{
				Domain:   vars["domain"],
				TenantID: vars["tenant"],
			})
			if err != nil {
				return nil, fmt.Errorf("error getting tenant domain: %w", err)
			}

			records, err := net.LookupTXT(vars["domain"])
			if err != nil {
				return nil, fmt.Errorf("error looking up TXT record: %w", err)
			}

			var verified = false
			for _, record := range records {
				if strings.HasPrefix(record, "mttx") && strings.TrimPrefix(record, "mttx") == domain.LinkingCode {
					verified = true
				}
			}

			if domain.Verified != verified {
				if err := DB.UpdateDomain(r.Context(), db.UpdateDomainParams{
					Domain:   vars["domain"],
					TenantID: vars["tenant"],
					Verified: verified,
				}); err != nil {
					return nil, fmt.Errorf("error updating domain verified status: %w", err)
				}
			}

			return verified, nil
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)
			return DB.DeleteDomain(r.Context(), db.DeleteDomainParams{
				Domain:   vars["domain"],
				TenantID: vars["tenant"],
			})
		},
	}.Handler(srv.DB)
}
