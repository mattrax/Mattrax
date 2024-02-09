package azuread

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"

	"gopkg.in/square/go-jose.v2"
	"gopkg.in/square/go-jose.v2/jwt"
)

// AuthClaims has the claims for Microsoft AzureAD JWT authentication token
type AuthClaims struct {
	Issuer   string           `json:"iss"`
	Audience string           `json:"aud"`
	IssuedAt *jwt.NumericDate `json:"iat"`
	Expiry   *jwt.NumericDate `json:"exp"`

	ObjectID          string `json:"oid,omitempty"`
	UserPrincipalName string `json:"upn,omitempty"`
	TenantID          string `json:"tid,omitempty"`
	Name              string `json:"name,omitempty"`
	DeviceID          string `json:"deviceid,omitempty"`
}

const microsoftOpenIDConfigurationURL = "https://login.microsoftonline.com/common/.well-known/openid-configuration"

// OpenIDConfiguration contains the configuration for a servers OpenID endpoints
type OpenIDConfiguration struct {
	JWKSURI string `json:"jwks_uri"`
}

// GetMicrosoftOpenIDJWKS returns the JWKS for Microsoft authentication
func GetMicrosoftOpenIDJWKS() jose.JSONWebKeySet {
	configResp, err := http.Get(microsoftOpenIDConfigurationURL)
	if err != nil {
		log.Printf("[Error] Microsoft OpenID | error retrieving configuration: %v\n", err)
		return jose.JSONWebKeySet{}
	}

	configBody, err := ioutil.ReadAll(configResp.Body)
	if err != nil {
		log.Printf("[Error] Microsoft OpenID | error reading configuration response body: %v\n", err)
		return jose.JSONWebKeySet{}
	}

	if configResp.StatusCode != http.StatusOK {
		log.Printf("[Error] Microsoft OpenID | error configuration returned status %v with error:%v\n", configResp.StatusCode, configBody)
		return jose.JSONWebKeySet{}
	}

	var config OpenIDConfiguration
	if err := json.Unmarshal(configBody, &config); err != nil {
		log.Printf("[Error] Microsoft OpenID | error parsing Microsoft OpenID Configuration response body: %v\n", err)
		return jose.JSONWebKeySet{}
	}

	if config.JWKSURI == "" {
		log.Printf("[Error] Microsoft OpenID | JWKS URI missing in OpenID Configuration\n")
		return jose.JSONWebKeySet{}
	}

	resp, err := http.Get(config.JWKSURI)
	if err != nil {
		log.Printf("[Error] Microsoft OpenID | error retrieving Microsoft OpenID JWKS keys: %v\n", err)
		return jose.JSONWebKeySet{}
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Error] Microsoft OpenID | error reading JWKS keys response body: %v\n", err)
		return jose.JSONWebKeySet{}
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[Error] Microsoft OpenID | error JWKS keys returned status %v with error:%v\n", configResp.StatusCode, body)
		return jose.JSONWebKeySet{}
	}

	var keys jose.JSONWebKeySet
	if err := json.Unmarshal(body, &keys); err != nil {
		log.Printf("[Error] Microsoft OpenID | error parsing Microsoft OpenID JWKS keys response body: %v\n", err)
		return jose.JSONWebKeySet{}
	}

	return keys
}
