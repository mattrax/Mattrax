package azuread

import (
	"fmt"
	"log"
	"sync"
	"time"

	"gopkg.in/square/go-jose.v2"
	"gopkg.in/square/go-jose.v2/jwt"
)

// Service handles certificate generation, retrieval and signing on behalf of the rest of the server.
type Service struct {
	microsoftJWKS     jose.JSONWebKeySet
	microsoftJWKSLock sync.RWMutex
}

// VerifyAuthenticationToken verifies if the authentication token was issued by Microsoft and decodes its claims
func (s *Service) VerifyAuthenticationToken(microsoftJWT string) (*AuthClaims, error) {
	token, err := jwt.ParseSigned(microsoftJWT)
	if err != nil {
		return nil, fmt.Errorf("error parsing JWT: %w", err)
	}

	s.microsoftJWKSLock.RLock()
	var microsoftJWKS = s.microsoftJWKS
	s.microsoftJWKSLock.RUnlock()

	issuerCerts := microsoftJWKS.Key(token.Headers[0].KeyID)
	if len(issuerCerts) == 0 {
		return nil, fmt.Errorf("the token was signed with an untrusted certificate")
	}

	var claims AuthClaims
	if err := token.Claims(&issuerCerts[0], &claims); err != nil {
		return nil, fmt.Errorf("error decoding claims in token: %w", err)
	}

	// TODO: Validate issuer application is trusted by server

	return &claims, nil
}

// New creates a new AzureAD service
func New() (*Service, error) {
	var s = Service{
		microsoftJWKS: GetMicrosoftOpenIDJWKS(),
	}
	if len(s.microsoftJWKS.Keys) == 0 {
		return nil, fmt.Errorf("No Microsoft OpenID Keys were returned. These are required for AzureAD logins to succeed")
	}

	go func() {
		time.Sleep(2 * time.Hour)

		microsoftJWKS := GetMicrosoftOpenIDJWKS()
		if len(s.microsoftJWKS.Keys) == 0 {
			log.Println("[Error] Microsoft OpenID | No Microsoft OpenID keys were returned. This should be investigated!")
		} else {
			log.Println("Updated Microsoft OpenID Keys")
			s.microsoftJWKSLock.Lock()
			s.microsoftJWKS = microsoftJWKS
			s.microsoftJWKSLock.Unlock()
		}
	}()

	return &s, nil
}
