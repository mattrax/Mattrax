package http_api

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/pkg/null"
)

func Applications(srv *mattrax.Server) http.HandlerFunc {
	type CreateRequest struct {
		Name null.String `json:"name" validate:"required,alphanumspace,min=1,max=100"`
	}

	type CreateResponse struct {
		ApplicationID string `json:"application_id"`
	}

	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			applications, err := DB.GetApplications(r.Context(), db.GetApplicationsParams{
				TenantID: vars["tenant"],
				Limit:    limit,
				Offset:   offset,
			})

			if applications == nil {
				applications = make([]db.GetApplicationsRow, 0)
			}

			return applications, err
		},
		PostType: func(r *http.Request) interface{} {
			return &CreateRequest{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			app, ok := cmd.(*CreateRequest)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			appID, err := DB.NewApplication(r.Context(), db.NewApplicationParams{
				TenantID: vars["tenant"],
				Name:     app.Name,
			})

			return CreateResponse{
				ApplicationID: appID,
			}, err
		},
	}.Handler(srv.DB)
}

func Application(srv *mattrax.Server) http.HandlerFunc {
	type ApplicationResponse struct {
		db.GetApplicationRow
		Targets []db.GetApplicationTargetsRow `json:"targets"`
	}

	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			app, err := DB.GetApplication(r.Context(), db.GetApplicationParams{
				ID:       vars["aid"],
				TenantID: vars["tenant"],
			})
			if err != nil {
				return nil, fmt.Errorf("error getting application: %w", err)
			}

			appTargets, err := DB.GetApplicationTargets(r.Context(), db.GetApplicationTargetsParams{
				AppID:    vars["aid"],
				TenantID: vars["tenant"],
			})

			return ApplicationResponse{app, appTargets}, err
		},
		PatchType: func(r *http.Request) interface{} {
			return &db.Application{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			app, ok := cmd.(*db.Application)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			err := DB.UpdateApplication(r.Context(), db.UpdateApplicationParams{
				ID:          vars["aid"],
				TenantID:    vars["tenant"],
				Name:        app.Name,
				Description: app.Description,
				Publisher:   app.Publisher,
			})

			return nil, err
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)
			return DB.DeleteApplication(r.Context(), db.DeleteApplicationParams{
				ID:       vars["aid"],
				TenantID: vars["tenant"],
			})
		},
	}.Handler(srv.DB)
}
