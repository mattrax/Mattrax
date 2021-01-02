package http_api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/lib/pq"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/internal/middleware"
	"github.com/openzipkin/zipkin-go"
	"github.com/rs/zerolog/log"
)

type Endpoint struct {
	Get       func(r *http.Request, DB *db.Queries) (interface{}, error)
	GetAll    func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error)
	PostType  func(r *http.Request) interface{}
	Post      func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error)
	PatchType func(r *http.Request) interface{}
	Patch     func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error)
	Delete    func(r *http.Request, DB *db.Queries) error
}

func (e Endpoint) Handler(DB *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		span := zipkin.SpanOrNoopFromContext(r.Context())
		tx := middleware.DBTxFromContext(r.Context())

		if r.Method == http.MethodGet && e.Get != nil {
			resp, err := e.Get(r, DB.WithTx(tx))
			if err == sql.ErrNoRows {
				span.Tag("warn", "resource not found")
				w.WriteHeader(http.StatusNotFound)
				return
			} else if err != nil {
				route := mux.CurrentRoute(r)
				if route != nil {
					log.Error().Err(err).Str("route", route.GetName()).Msg("Error with method Get of endpoint")
				} else {
					log.Error().Err(err).Msg("Error with method Get")
				}
				span.Tag("err", fmt.Sprintf("Error with method Get of endpoint: %s", err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			if resp == nil {
				w.WriteHeader(http.StatusNoContent)
			} else {
				w.Header().Set("Content-Type", "application/json; charset=UTF-8")
				if err := json.NewEncoder(w).Encode(resp); err != nil {
					log.Debug().Err(err).Msg("Error encoding JSON response")
					span.Tag("warn", fmt.Sprintf("error encoding JSON response: %s", err))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
			}
		} else if r.Method == http.MethodGet && e.GetAll != nil {
			// TODO: Refactor this function into here
			limit, offset, err := middleware.GetPaginationParams(r.URL.Query())
			if err != nil {
				span.Tag("warn", fmt.Sprintf("%s", err))
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			span.Tag("limit", fmt.Sprintf("%v", limit))
			span.Tag("offset", fmt.Sprintf("%v", offset))

			resp, err := e.GetAll(r, DB.WithTx(tx), limit, offset)
			if err != nil {
				route := mux.CurrentRoute(r)
				if route != nil {
					log.Error().Err(err).Str("route", route.GetName()).Msg("Error with method GetAll of endpoint")
				} else {
					log.Error().Err(err).Msg("Error with method GetAll")
				}
				span.Tag("err", fmt.Sprintf("Error with method GetAll of endpoint: %s", err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			if resp == nil {
				w.WriteHeader(http.StatusNoContent)
			} else {
				w.Header().Set("Content-Type", "application/json; charset=UTF-8")
				if err := json.NewEncoder(w).Encode(resp); err != nil {
					log.Debug().Err(err).Msg("Error encoding JSON response")
					span.Tag("warn", fmt.Sprintf("error encoding JSON response: %s", err))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
			}
		} else if (r.Method == http.MethodPatch || r.Method == http.MethodPost) && (e.Post != nil || e.Patch != nil) {
			var cmd interface{} = &map[string]interface{}{}
			if e.PostType != nil {
				cmd = e.PostType(r)
			} else if e.PatchType != nil {
				cmd = e.PatchType(r)
			}

			if err := json.NewDecoder(r.Body).Decode(cmd); err != nil {
				log.Printf("[JsonDecode Error]: %s\n", err)
				span.Tag("warn", fmt.Sprintf("JSON decode error: %s", err))
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			if err := validate.Struct(cmd); err != nil {
				// TODO: Log output
				span.Tag("err", fmt.Sprintf("error validing request: %s", err))
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			var handler func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error)
			if e.Post != nil {
				handler = e.Post
			} else {
				handler = e.Patch
			}

			resp, err := handler(r, DB.WithTx(tx), cmd)
			if err != nil {
				if pqe, ok := err.(*pq.Error); ok && string(pqe.Code) == "23505" {
					span.Tag("warn", fmt.Sprintf("unique constraint violation: %s", err))
					w.WriteHeader(http.StatusUnprocessableEntity)
					return
				}
				route := mux.CurrentRoute(r)
				if route != nil {
					log.Error().Err(err).Str("route", route.GetName()).Msg("Error with method Patch of endpoint")
				} else {
					log.Error().Err(err).Msg("Error with method Patch")
				}
				span.Tag("err", fmt.Sprintf("Error with method Patch of endpoint: %s", err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			if resp == nil {
				w.WriteHeader(http.StatusNoContent)
			} else {
				w.Header().Set("Content-Type", "application/json; charset=UTF-8")
				if err := json.NewEncoder(w).Encode(resp); err != nil {
					log.Debug().Err(err).Msg("Error encoding JSON response")
					span.Tag("warn", fmt.Sprintf("error encoding JSON response: %s", err))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
			}
		} else if r.Method == http.MethodDelete && e.Delete != nil {
			if err := e.Delete(r, DB.WithTx(tx)); err == sql.ErrNoRows {
				span.Tag("warn", "resource not found")
				w.WriteHeader(http.StatusNotFound)
				return
			} else if err != nil {
				route := mux.CurrentRoute(r)
				if route != nil {
					log.Error().Err(err).Str("route", route.GetName()).Msg("Error with method Delete of endpoint")
				} else {
					log.Error().Err(err).Msg("Error with method Delete")
				}
				span.Tag("err", fmt.Sprintf("Error with method Delete of endpoint: %s", err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusNoContent)
		} else {
			route := mux.CurrentRoute(r)
			if route != nil {
				log.Debug().Str("route", route.GetName()).Str("method", r.Method).Msg("Endpoint not implemented")
				span.Tag("warn", fmt.Sprintf("Endpoint '%s' not implemented for method '%s'", route.GetName(), r.Method))
			} else {
				log.Debug().Str("url", r.URL.String()).Str("method", r.Method).Msg("Endpoint not implemented")
				span.Tag("warn", fmt.Sprintf("Endpoint '%s' not implemented for method '%s'", route.GetName(), r.Method))
			}

			w.WriteHeader(http.StatusNotImplemented)
		}
	}
}
