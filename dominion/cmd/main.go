package main

import (
	"log"
	"os"

	"github.com/oscartbeaumont/forge/dominion/internal/api"
	"github.com/oscartbeaumont/forge/dominion/internal/azuread"
	"github.com/oscartbeaumont/forge/dominion/internal/certificates"
)

// checkEnv verifies the required environment varibles have been set
func checkEnv() string {
	if os.Getenv("DOMAIN") == "" {
		return "[Error] Server primary domain not defined"
	}

	if os.Getenv("MANAGEMENT_DOMAIN") == "" {
		return "[Error] Server management domain not defined"
	}

	if os.Getenv("API_DOMAIN") == "" {
		return "[Error] API domain not defined"
	}

	if os.Getenv("TLS_CERT_PATH") == "" {
		return "[Error] TLS certificate path not defined"
	}

	if os.Getenv("TLS_KEY_PATH") == "" {
		return "[Error] TLS key path not defined"
	}

	if os.Getenv("IDENTITY_CERT_POOL_PATH") == "" {
		return "[Error] Identity cert pool path not defined"
	}

	if os.Getenv("IDENTITY_CERT_PATH") == "" {
		return "[Error] Identity cert certificate path not defined"
	}

	if os.Getenv("IDENTITY_KEY_PATH") == "" {
		return "[Error] Identity cert key path not defined"
	}

	if os.Getenv("IDENTITY_KEY_PASSWORD") == "" {
		return "[Error] Identity cert key password not defined"
	}

	return ""
}

// main is the servers entrypoint
func main() {
	if errTxt := checkEnv(); errTxt != "" {
		log.Println(errTxt)
		os.Exit(1)
	}

	aad, err := azuread.New()
	if err != nil {
		log.Println("[Error] Initialising AzureAD service:", err)
		os.Exit(1)
	}

	cs, err := certificates.New(os.Getenv("IDENTITY_CERT_POOL_PATH"), os.Getenv("IDENTITY_CERT_PATH"), os.Getenv("IDENTITY_KEY_PATH"), os.Getenv("IDENTITY_KEY_PASSWORD"))
	if err != nil {
		log.Println("[Error] Initialising certificate service:", err)
		os.Exit(1)
	}

	mttxAPI := api.New(os.Getenv("API_DOMAIN"))

	r := routes(mttxAPI, aad, cs)
	go serve(":8443", os.Getenv("TLS_CERT_PATH"), os.Getenv("TLS_KEY_PATH"), cs.IdentityCertPool, r)
	serve(":443", os.Getenv("TLS_CERT_PATH"), os.Getenv("TLS_KEY_PATH"), nil, r)
}
