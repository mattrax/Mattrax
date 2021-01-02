package authentication

import (
	"crypto/rsa"
	"fmt"
	"net/url"
	"time"

	"github.com/mattrax/Mattrax/internal/certificates"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/patrickmn/go-cache"
	"github.com/rs/zerolog/log"
	"gopkg.in/square/go-jose.v2"
	"gopkg.in/square/go-jose.v2/jwt"
)

// Service provides helpers for verifying and creating authentication tokens
type Service struct {
	privateKey *rsa.PrivateKey
	cache      *cache.Cache
	signer     jose.Signer
	issuer     string
	db         *db.Queries
	debugMode  bool
}

// Token parses a JWT, verifies it is valid and returns the claims held inside it
func (as Service) Token(rawToken string) (AuthClaims, error) {
	// Note: This authentication bypass for when development mode is enabled isn't great.
	// TODO: Remove it when possible!
	if as.debugMode && rawToken == "VIRTUAL_DEVICE_AUTH_TOKEN" {
		return AuthClaims{
			Subject: "virt@mattrax.app",
		}, nil
	}

	token, err := jwt.ParseSigned(rawToken)
	if err != nil {
		return AuthClaims{}, err
	}

	var basicClaims BasicClaims
	if err := token.UnsafeClaimsWithoutVerification(&basicClaims); err != nil {
		return AuthClaims{}, err
	}

	if time.Now().After(basicClaims.Expiry.Time()) {
		return AuthClaims{}, fmt.Errorf("the token has expired")
	}

	if basicClaims.Issuer == as.issuer {
		var claims AuthClaims
		if err := token.Claims(&as.privateKey.PublicKey, &claims); err != nil {
			return AuthClaims{}, err
		}

		return claims, nil
	}

	// TODO
	// settings, err := as.db.Settings(context.TODO())
	// if err != nil {
	// 	return AuthClaims{}, err
	// }

	if err != nil {
		log.Error().Err(err).Msg("Error getting AAD Tenant ID from settings")
		return AuthClaims{}, fmt.Errorf("the tokens legitimacy could not be verified due to an internal error")
	} //else if settings.TenantAzureid == "" {
	// 	return AuthClaims{}, fmt.Errorf("the token was signed with an untrusted certificate")
	// }

	var microsoftJWKS jose.JSONWebKeySet
	if value, found := as.cache.Get("microsoft-jwks"); !found {
		microsoftJWKS = GetMicrosoftOpenIDJWKS()
		if len(microsoftJWKS.Keys) == 0 {
			log.Error().Msg("No Microsoft OpenID Keys were returned. These are required for AzureAD logins to succeed")
			return AuthClaims{}, fmt.Errorf("error retrieving Microsoft Open ID JWKS")
		}
		as.cache.Set("microsoft-jwks", microsoftJWKS, cache.DefaultExpiration)
		log.Debug().Msg("updated Microsoft Graph Open ID tokens!")
	} else {
		microsoftJWKS = value.(jose.JSONWebKeySet)
	}

	issuerCerts := microsoftJWKS.Key(token.Headers[0].KeyID)
	if len(issuerCerts) <= 0 {
		return AuthClaims{}, nil
	}

	if len(issuerCerts) == 0 {
		return AuthClaims{}, fmt.Errorf("the token was signed with an untrusted certificate")
	}

	var msClaims MicrosoftSpecificAuthClaims
	if err := token.Claims(&issuerCerts[0], &msClaims); err != nil {
		return AuthClaims{}, err
	}

	// if msClaims.TenantID != settings.TenantAzureid {
	// 	return AuthClaims{}, fmt.Errorf("the user token was issued for another Azure Active Directory tenant")
	// }

	return AuthClaims{
		BasicClaims:                 basicClaims,
		MicrosoftSpecificAuthClaims: msClaims,
		Subject:                     msClaims.UserPrincipalName,
		FullName:                    msClaims.Name,
		Authenticated:               true,
		AuthenticationOnly:          true,
	}, nil
}

// IssueToken creates a new token from claims
func (as Service) IssueToken(audience string, claims AuthClaims) (string, BasicClaims, error) {
	var now = time.Now()
	claims.BasicClaims = BasicClaims{
		Issuer:   as.issuer,
		Audience: audience,
		IssuedAt: jwt.NewNumericDate(now),
		Expiry:   jwt.NewNumericDate(now.Add(time.Hour)),
	}

	token, err := jwt.Signed(as.signer).Claims(claims).CompactSerialize()
	if err != nil {
		return "", BasicClaims{}, err
	}

	return token, claims.BasicClaims, nil
}

// New returns a new AuthenticationService after it has been initialised
func New(certService *certificates.Service, cache *cache.Cache, db *db.Queries, domain string, debugMode bool) (*Service, error) {
	var issuer = (&url.URL{Scheme: "https", Host: domain}).String()

	var signerOpts = jose.SignerOptions{}
	signerOpts.WithType("JWT")

	var rsaPrivateKey = certService.AuthenticationKey()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: rsaPrivateKey}, &signerOpts)
	if err != nil {
		return nil, err
	}

	return &Service{rsaPrivateKey, cache, signer, issuer, db, debugMode}, nil
}
