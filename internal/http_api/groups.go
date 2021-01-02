package http_api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/pkg/null"
)

func Groups(srv *mattrax.Server) http.HandlerFunc {
	type CreateRequest struct {
		Name string `json:"name" validate:"required,alphanumspace,min=1,max=100"`
	}

	type CreateResponse struct {
		GroupID string `json:"group_id"`
	}

	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			groups, err := DB.GetGroups(r.Context(), db.GetGroupsParams{
				TenantID: vars["tenant"],
				Limit:    limit,
				Offset:   offset,
			})

			if groups == nil {
				groups = make([]db.GetGroupsRow, 0)
			}

			return groups, err
		},
		PostType: func(r *http.Request) interface{} {
			return &CreateRequest{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			group, ok := cmd.(*CreateRequest)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			groupID, err := DB.NewGroup(r.Context(), db.NewGroupParams{
				TenantID: vars["tenant"],
				Name: null.String{
					String: group.Name,
					Valid:  true,
				},
			})

			return CreateResponse{
				GroupID: groupID,
			}, err
		},
	}.Handler(srv.DB)
}

func Group(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			return DB.GetGroup(r.Context(), db.GetGroupParams{
				ID:       vars["gid"],
				TenantID: vars["tenant"],
			})
		},
		PatchType: func(r *http.Request) interface{} {
			return &db.Group{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			group, ok := cmd.(*db.Group)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			err := DB.UpdateGroup(r.Context(), db.UpdateGroupParams{
				ID:       vars["gid"],
				TenantID: vars["tenant"],
				Name:     group.Name,
			})

			return nil, err
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)
			return DB.DeleteGroup(r.Context(), db.DeleteGroupParams{
				ID:       vars["gid"],
				TenantID: vars["tenant"],
			})
		},
	}.Handler(srv.DB)
}

func GroupPolicies(srv *mattrax.Server) http.HandlerFunc {
	type Request struct {
		Policies []string `json:"policies"`
	}

	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			policies, err := DB.GetPoliciesInGroup(r.Context(), db.GetPoliciesInGroupParams{
				TenantID: vars["tenant"],
				GroupID:  vars["gid"],
				Limit:    100,
				Offset:   0,
			})

			if policies == nil {
				policies = make([]db.GetPoliciesInGroupRow, 0)
			}

			return policies, err
		},
		PostType: func(r *http.Request) interface{} {
			return &Request{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			req, ok := cmd.(*Request)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			for _, policyID := range req.Policies {
				if err := DB.AddPolicyToGroup(r.Context(), db.AddPolicyToGroupParams{
					GroupID:  vars["gid"],
					PolicyID: policyID,
				}); err != nil {
					return nil, fmt.Errorf("error adding policy to group: %w", err)
				}
			}

			return nil, nil
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)

			var cmd Request
			if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
				// TODO: 400: Bad Request return status
				return fmt.Errorf("error decoding JSON body: %w", err)
			}

			for _, policyID := range cmd.Policies {
				if err := DB.RemovePolicyFromGroup(r.Context(), db.RemovePolicyFromGroupParams{
					GroupID:  vars["gid"],
					PolicyID: policyID,
				}); err != nil {
					return fmt.Errorf("error removing policy from group: %w", err)
				}
			}

			return nil
		},
	}.Handler(srv.DB)
}

func GroupDevices(srv *mattrax.Server) http.HandlerFunc {
	type Request struct {
		Devices []string `json:"devices"`
	}

	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			devices, err := DB.GetDevicesInGroup(r.Context(), db.GetDevicesInGroupParams{
				TenantID: vars["tenant"],
				GroupID:  vars["gid"],
				Limit:    100,
				Offset:   0,
			})

			if devices == nil {
				devices = make([]db.GetDevicesInGroupRow, 0)
			}

			return devices, err
		},
		PostType: func(r *http.Request) interface{} {
			return &Request{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			req, ok := cmd.(*Request)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			for _, deviceID := range req.Devices {
				if err := DB.AddDeviceToGroup(r.Context(), db.AddDeviceToGroupParams{
					GroupID:  vars["gid"],
					DeviceID: deviceID,
				}); err != nil {
					return nil, fmt.Errorf("error adding device to group: %w", err)
				}
			}

			return nil, nil
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)

			var cmd Request
			if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
				// TODO: 400: Bad Request return status
				return fmt.Errorf("error decoding JSON body: %w", err)
			}

			for _, deviceID := range cmd.Devices {
				if err := DB.RemoveDeviceFromGroup(r.Context(), db.RemoveDeviceFromGroupParams{
					GroupID:  vars["gid"],
					DeviceID: deviceID,
				}); err != nil {
					return fmt.Errorf("error removing device from group: %w", err)
				}
			}

			return nil
		},
	}.Handler(srv.DB)
}
