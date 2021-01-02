package main

import (
	"context"
	"database/sql"
	"math/rand"
	"os"
	"time"

	"github.com/alexflint/go-arg"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/api"
	"github.com/mattrax/Mattrax/internal/authentication"
	"github.com/mattrax/Mattrax/internal/certificates"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/internal/http_api"
	"github.com/mattrax/Mattrax/internal/middleware"
	"github.com/mattrax/Mattrax/internal/settings"
	"github.com/mattrax/Mattrax/mdm"
	"github.com/mattrax/Mattrax/pkg/null"
	"github.com/openzipkin/zipkin-go"
	zipkinhttp "github.com/openzipkin/zipkin-go/middleware/http"
	"github.com/openzipkin/zipkin-go/model"
	reporterhttp "github.com/openzipkin/zipkin-go/reporter/http"
	"github.com/patrickmn/go-cache"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func RandStringBytes(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

func main() {
	var args mattrax.Arguments
	arg.MustParse(&args)
	// TODO: Verify arguments (eg. Domain is domain, cert paths exists, valid listen addr)

	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	if args.Debug {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	}

	var tracer *zipkin.Tracer
	if args.Zipkin != "" {
		hostname, err := os.Hostname()
		if err != nil {
			log.Fatal().Err(err).Msg("Error retrieving node hostname")
		}

		tracer, err = zipkin.NewTracer(reporterhttp.NewReporter(args.Zipkin), zipkin.WithSampler(zipkin.AlwaysSample),
			zipkin.WithLocalEndpoint(&model.Endpoint{ServiceName: hostname}))
		if err != nil {
			log.Fatal().Err(err).Msg("Error initialising Zipkin")
		}
	}

	dbconn, err := sql.Open("postgres", args.DB)
	if err != nil {
		log.Fatal().Err(err).Msg("Error initialising Postgres database connection")
	}
	defer dbconn.Close()

	if err := dbconn.Ping(); err != nil {
		log.Fatal().Err(err).Msg("Error communicating with Postgres database")
	}

	q := db.New(dbconn)
	defer q.Close()

	// TODO: Check DB is working by querying

	var srv = &mattrax.Server{
		Args:         args,
		GlobalRouter: mux.NewRouter(),
		DB:           q,
		DBConn:       dbconn,
		Cache:        cache.New(5*time.Minute, 10*time.Minute),
	}
	if srv.Settings, err = settings.New(srv.DB); err != nil {
		log.Fatal().Err(err).Msg("Error starting settings service")
	}
	if srv.Cert, err = certificates.New(srv.DB); err != nil {
		log.Fatal().Err(err).Msg("Error starting certificates service")
	}
	if srv.Auth, err = authentication.New(srv.Cert, srv.Cache, srv.DB, args.Domain, args.Debug); err != nil {
		log.Fatal().Err(err).Msg("Error starting authentication service")
	}
	if srv.API, err = api.New(srv.DB); err != nil {
		log.Fatal().Err(err).Msg("Error starting API service")
	}

	if userCount, err := srv.DB.GetUserCount(context.Background()); err != nil {
		log.Fatal().Err(err).Msg("Error getting user count")
	} else if userCount == 0 {
		password := RandStringBytes(10)

		passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), 15)
		if err != nil {
			log.Fatal().Err(err).Msg("Error hashing default user password")
		}

		if err := srv.DB.NewGlobalUser(context.Background(), db.NewGlobalUserParams{
			UPN: "admin@mattrax.app",
			Fullname: null.String{
				String: "Mattrax Admin",
				Valid:  true,
			},
			Password: null.String{
				String: string(passwordHash),
				Valid:  true,
			},
			PasswordExpiry: sql.NullTime{
				Time:  time.Now(),
				Valid: true,
			},
		}); err != nil {
			log.Fatal().Err(err).Msg("Error creating default user")
		}
		log.Info().Str("upn", "admin@mattrax.app").Str("password", password).Msg("Created default administrator account")
	}

	srv.GlobalRouter.Use(middleware.Logging())
	srv.GlobalRouter.Use(middleware.Headers())
	if tracer != nil {
		srv.GlobalRouter.Use(zipkinhttp.NewServerMiddleware(tracer, zipkinhttp.TagResponseSize(true)))
		srv.GlobalRouter.Use(middleware.ZipkinExtended)
	}
	srv.Router = srv.GlobalRouter.Schemes("https").Host(args.Domain).Subrouter()
	mdm.Mount(srv)
	http_api.Mount(srv)

	serve(args.Addr, args.Domain, args.TLSCert, args.TLSKey, nil, srv.GlobalRouter)
}
