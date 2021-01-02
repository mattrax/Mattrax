package android

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/internal/middleware"
	"github.com/mattrax/Mattrax/pkg/null"
	"github.com/openzipkin/zipkin-go"
	"github.com/pkg/errors"
	"github.com/skip2/go-qrcode"
	"google.golang.org/api/androidmanagement/v1"
)

func (p *Protocol) MountAPI(r *mux.Router, rUnauthenticated *mux.Router) error {
	r.HandleFunc("/{tenant}/devices/android/qr", AndroidEnrollmentQR(p.srv, p)).Methods(http.MethodGet, http.MethodOptions).Name("/devices/android/qr")
	rUnauthenticated.HandleFunc("/{tenant}/android/organisation/signup/callback", AndroidOrganisationCallback(p.srv, p)).Methods(http.MethodGet, http.MethodOptions).Name("/android/organisation/signup/callback")
	r.HandleFunc("/{tenant}/android/organisation/signup", AndroidOrganisation(p.srv, p)).Methods(http.MethodGet, http.MethodOptions).Name("/android/organisation/signup")
	return nil
}

func AndroidEnrollmentQR(srv *mattrax.Server, p *Protocol) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tx := middleware.DBTxFromContext(r.Context())
		span := zipkin.SpanOrNoopFromContext(r.Context())
		vars := mux.Vars(r)

		tenant, err := srv.DB.WithTx(tx).GetTenant(r.Context(), vars["tenant"])
		if err == sql.ErrNoRows {
			span.Tag("warn", "tenant not found")
			w.WriteHeader(http.StatusUnauthorized)
			return
		} else if err != nil {
			log.Printf("[GetTenant Error]: %s\n", err)
			span.Tag("err", fmt.Sprintf("error retrieving tenant: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if !tenant.AfwEnterpriseID.Valid {
			w.WriteHeader(http.StatusNotImplemented)
			return
		}

		token, err := p.ams.Enterprises.EnrollmentTokens.Create(fmt.Sprintf("enterprises/%s", tenant.AfwEnterpriseID.String), &androidmanagement.EnrollmentToken{}).Do()
		if err != nil {
			panic(err) // TODO
		}

		png, err := qrcode.Encode(token.QrCode, qrcode.Medium, 256)
		if err != nil {
			panic(err) // TEMP
		}

		w.Write(png)
	}
}

func AndroidOrganisation(srv *mattrax.Server, p *Protocol) http.HandlerFunc {
	type Response struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}

	route := srv.GlobalRouter.GetRoute("/android/organisation/signup/callback")
	if route == nil {
		panic("Error acquiring named route") // TODO

	}

	return func(w http.ResponseWriter, r *http.Request) {
		// tx := middleware.DBTxFromContext(r.Context())
		span := zipkin.SpanOrNoopFromContext(r.Context())
		vars := mux.Vars(r)

		stateID, err := srv.DB.AFWCreateState(r.Context())
		if err != nil {
			panic(err) // TODO
		}

		url, err := route.URL("tenant", vars["tenant"])
		if err != nil {
			panic(errors.Wrap(err, "Error acquiring url of named route")) // TODO
		}
		url.RawQuery = "state=" + stateID

		signupURL, err := p.ams.SignupUrls.Create().ProjectId(p.amsProjectID).CallbackUrl(url.String()).Do()
		if err != nil {
			panic(err) // TODO
		}

		if err := srv.DB.AFWUpdateState(r.Context(), db.AFWUpdateStateParams{
			ID: stateID,
			Name: null.String{
				String: signupURL.Name,
				Valid:  true,
			},
		}); err != nil {
			panic(err) // TODO
		}

		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		if err := json.NewEncoder(w).Encode(Response{
			Name: signupURL.Name,
			URL:  signupURL.Url,
		}); err != nil {
			span.Tag("warn", fmt.Sprintf("error encoding JSON response: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}
}

func AndroidOrganisationCallback(srv *mattrax.Server, p *Protocol) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		span := zipkin.SpanOrNoopFromContext(r.Context())
		vars := mux.Vars(r)

		if r.URL.Query().Get("state") == "" || r.URL.Query().Get("enterpriseToken") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		tenant, err := srv.DB.GetTenant(r.Context(), vars["tenant"])
		if err == sql.ErrNoRows {
			span.Tag("warn", "tenant not found")
			w.WriteHeader(http.StatusUnauthorized)
			return
		} else if err != nil {
			log.Printf("[GetTenant Error]: %s\n", err)
			span.Tag("err", fmt.Sprintf("error retrieving tenant: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		signupName, err := srv.DB.AFWGetAndRemoveState(r.Context(), r.URL.Query().Get("state"))
		if err != nil {
			log.Printf("[AFWGetAndRemoveState Error]: %s\n", err)
			span.Tag("err", fmt.Sprintf("error retrieving afw state: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		enterprise, err := p.ams.Enterprises.Create(&androidmanagement.Enterprise{
			EnterpriseDisplayName: tenant.DisplayName.String,
			// Logo: &androidmanagement.ExternalData{
			// 	Url: "",
			// 	Sha256Hash: "",
			// },
			EnabledNotificationTypes: []string{"ENROLLMENT", "STATUS_REPORT", "COMMAND"},
			PubsubTopic:              p.pubsubTopic,
			PrimaryColor:             (0 << 16) | (130 << 8) | 200,
			SigninDetails: []*androidmanagement.SigninDetail{
				{
					SigninUrl: "https://mdm.otbeaumont.me/TODO", // TODO
				},
			},
			TermsAndConditions: []*androidmanagement.TermsAndConditions{
				{
					// TODO
					Header: &androidmanagement.UserFacingMessage{
						DefaultMessage: "Testing",
					},
					Content: &androidmanagement.UserFacingMessage{
						DefaultMessage: "You must allow it!",
					},
				},
			},
		}).ProjectId(p.amsProjectID).SignupUrlName(signupName.String).EnterpriseToken(r.URL.Query().Get("enterpriseToken")).Do()
		if err != nil {
			panic(err) // TODO
		}

		var nameParts = strings.Split(enterprise.Name, "/")

		if err := srv.DB.AFWUpdateTenant(r.Context(), db.AFWUpdateTenantParams{
			ID: vars["tenant"],
			AfwEnterpriseID: null.String{
				String: nameParts[len(nameParts)-1],
				Valid:  true,
			},
		}); err != nil {
			log.Printf("[AFWUpdateTenant Error]: %s\n", err)
			span.Tag("err", fmt.Sprintf("error afw updating tenant: %s", err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.Write([]byte(`<script>window.close();</script>`))
	}
}
