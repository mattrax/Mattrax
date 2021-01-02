package http_api

import (
	"fmt"
	"net/http"

	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/pkg/null"
	"golang.org/x/crypto/bcrypt"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
)

func Users(srv *mattrax.Server) http.HandlerFunc {
	type CreateRequest struct {
		UPN      string `json:"upn" validate:"required,email,min=1,max=100"`
		FullName string `json:"fullname" validate:"required,alphanumspace,min=1,max=100"`
		Password string `json:"password" validate:"required,min=1,max=100"`
	}

	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			users, err := DB.GetUsersInTenant(r.Context(), db.GetUsersInTenantParams{
				TenantID: null.String{
					String: vars["tenant"],
					Valid:  true,
				},
				Limit:  limit,
				Offset: offset,
			})

			if users == nil {
				users = make([]db.GetUsersInTenantRow, 0)
			}

			return users, err
		},
		PostType: func(r *http.Request) interface{} {
			return &CreateRequest{}
		},
		Post: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			user, ok := cmd.(*CreateRequest)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			passwordHash, err := bcrypt.GenerateFromPassword([]byte(user.Password), 15)
			if err != nil {
				return nil, fmt.Errorf("error bcrypt hashing the users password: %w")
			}

			return nil, DB.NewUser(r.Context(), db.NewUserParams{
				UPN: user.UPN,
				Fullname: null.String{
					String: user.FullName,
					Valid:  true,
				},
				Password: null.String{
					String: string(passwordHash),
					Valid:  true,
				},
				TenantID: null.String{
					String: vars["tenant"],
					Valid:  true,
				},
			})
		},
	}.Handler(srv.DB)
}

func User(srv *mattrax.Server) http.HandlerFunc {
	// TODO: Join with db.User
	type PatchRequest struct {
		UPN      string      `json:"upn"`
		Fullname null.String `json:"fullname"`
		Disabled *bool       `json:"disabled"` // TODO: SQLC type override for this and then use db.User here
		Password null.String `json:"password"`
	}

	type PatchResponse struct {
		UPN string `json:"upn"`
	}

	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)
			return DB.GetUser(r.Context(), vars["upn"])
		},
		PatchType: func(r *http.Request) interface{} {
			return &PatchRequest{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			user, ok := cmd.(*PatchRequest)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			upn, err := DB.UpdateUserInTenant(r.Context(), db.UpdateUserInTenantParams{
				UPN: vars["upn"],
				TenantID: null.String{
					String: vars["tenant"],
					Valid:  true,
				},
				// UPN:      user.UPN,
				Fullname: user.Fullname,
				// Disabled: user.Disabled,
				Password: user.Password,
			})

			return PatchResponse{
				UPN: upn,
			}, err
		},
		Delete: func(r *http.Request, DB *db.Queries) error {
			vars := mux.Vars(r)
			return DB.DeleteUserInTenant(r.Context(), db.DeleteUserInTenantParams{
				UPN: vars["upn"],
				TenantID: null.String{
					Valid:  true,
					String: vars["tenant"],
				},
			})
		},
	}.Handler(srv.DB)
}
