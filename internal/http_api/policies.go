package http_api

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/pkg/null"
)

func Policies(srv *mattrax.Server) http.HandlerFunc {
	type CreateRequest struct {
		Name string `json:"name" validate:"required,alphanumspace,min=1,max=100"`
		Type string `json:"type"` // TODO: Validate if is valid policy type
	}

	type CreateResponse struct {
		PolicyID string `json:"policy_id"`
	}

	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			policies, err := DB.GetPolicies(r.Context(), db.GetPoliciesParams{
				TenantID: vars["tenant"],
				Limit:    limit,
				Offset:   offset,
			})

			if policies == nil {
				policies = make([]db.GetPoliciesRow, 0)
			}

			return policies, err
		},
		PostType: func(r *http.Request) interface{} {
			return &CreateRequest{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			policy, ok := cmd.(*CreateRequest)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			policyID, err := DB.NewPolicy(r.Context(), db.NewPolicyParams{
				TenantID: vars["tenant"],
				Name: null.String{
					String: policy.Name,
					Valid:  true,
				},
				Type: policy.Type,
			})

			return CreateResponse{
				PolicyID: policyID,
			}, err
		},
	}.Handler(srv.DB)
}

func Policy(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			return DB.GetPolicy(r.Context(), db.GetPolicyParams{
				ID:       vars["pid"],
				TenantID: vars["tenant"],
			})
		},
		PatchType: func(r *http.Request) interface{} {
			return &db.Policy{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			policy, ok := cmd.(*db.Policy)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			err := DB.UpdatePolicy(r.Context(), db.UpdatePolicyParams{
				ID:       vars["pid"],
				TenantID: vars["tenant"],
				Name:     policy.Name,
				Payload:  policy.Payload,
			})

			return nil, err
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)
			return DB.DeletePolicy(r.Context(), db.DeletePolicyParams{
				ID:       vars["pid"],
				TenantID: vars["tenant"],
			})
		},
	}.Handler(srv.DB)
}

func PolicyScope(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			groups, err := DB.GetPolicyGroups(r.Context(), db.GetPolicyGroupsParams{
				TenantID: vars["tenant"],
				PolicyID: vars["pid"],
			})

			if groups == nil {
				groups = make([]db.GetPolicyGroupsRow, 0)
			}

			return groups, err
		},
	}.Handler(srv.DB)
}
