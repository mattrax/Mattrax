package http_api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/api"
	"github.com/mattrax/Mattrax/internal/authentication"
	"github.com/openzipkin/zipkin-go"
)

func Login(srv *mattrax.Server) http.HandlerFunc {
	type Request struct {
		UPN      string `json:"upn"`
		Password string `json:"password"`
	}

	type Response struct {
		Token           string `json:"token"`
		PasswordExpired bool   `json:"passwordExpired"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		span := zipkin.SpanOrNoopFromContext(r.Context())

		var cmd Request
		if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
			span.Tag("warn", fmt.Sprintf("JSON decode error: %s", err))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		span.Tag("upn", cmd.UPN)

		var audience = "dashboard" // TODO: Set to enrollment if device enrolling process

		user, err := srv.API.Login(r.Context(), cmd.UPN, cmd.Password)
		if err == api.ErrIncorrectCredentials {
			span.Tag("warn", fmt.Sprintf("%s", err))
			w.WriteHeader(http.StatusUnauthorized)
			return
		} else if err == api.ErrUserIsDisabled {
			span.Tag("warn", fmt.Sprintf("%s", err))
			w.WriteHeader(http.StatusForbidden)
			return
		} else if err != nil {
			span.Tag("err", fmt.Sprintf("error authenticating user: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var expired = false
		if user.PasswordExpiry.Valid && time.Now().After(user.PasswordExpiry.Time) {
			expired = true
		}

		if audience != "enrollment" && user.TenantID.Valid == true {
			span.Tag("err", fmt.Sprintf("user does not have tenant permission to login to dashboard"))
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// sessionID, err := srv.DB.NewUserSession(r.Context(), cmd.UPN)
		// if err != nil {
		// 	log.Printf("[GetUserTenants Error]: %s\n", err)
		// 	span.Tag("err", fmt.Sprintf("error retrieving users tenants: %s", err))
		// 	w.WriteHeader(http.StatusInternalServerError)
		// 	return
		// }

		authToken, _, err := srv.Auth.IssueToken(audience, authentication.AuthClaims{
			Subject:  cmd.UPN,
			FullName: user.Fullname.String,
		})
		if err != nil {
			log.Printf("[IssueToken Error]: %s\n", err)
			span.Tag("err", fmt.Sprintf("error issuing auth token: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		if err := json.NewEncoder(w).Encode(Response{
			Token:           authToken,
			PasswordExpired: expired,
		}); err != nil {
			span.Tag("warn", fmt.Sprintf("error encoding JSON response: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}
}
