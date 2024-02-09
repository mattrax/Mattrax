package certificates

import (
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"io/ioutil"
	"log"

	"crypto/x509"
)

// Service handles certificate generation, retrieval and signing on behalf of the rest of the server.
type Service struct {
	IdentityCertPool    *x509.CertPool
	identityCertificate *x509.Certificate
	identityPrivateKey  *rsa.PrivateKey
}

// IsIssuerIdentity verifies if the certificate was issued by a trusted identity certificate
func (s *Service) IsIssuerIdentity(cert *x509.Certificate) error {
	_, err := cert.Verify(x509.VerifyOptions{
		Roots: s.IdentityCertPool,
	})
	return err
}

// GetIssuerIdentity returns the identity certificate and its private key
func (s *Service) GetIssuerIdentity() (*x509.Certificate, *rsa.PrivateKey, error) {
	return s.identityCertificate, s.identityPrivateKey, nil
}

// New initialises a new certificate service
func New(certPoolPath, certPath, keyPath, keyPassword string) (*Service, error) {
	s := &Service{
		IdentityCertPool: x509.NewCertPool(),
	}

	certPoolRaw, err := ioutil.ReadFile(certPoolPath)
	if err != nil {
		return nil, fmt.Errorf("error loading certificate pool: %v", err)
	}

	var certDERBlock *pem.Block
	for {
		certDERBlock, certPoolRaw = pem.Decode(certPoolRaw)
		if certDERBlock == nil {
			break
		}
		if certDERBlock.Type == "CERTIFICATE" {
			cert, err := x509.ParseCertificate(certDERBlock.Bytes)
			if err != nil {
				log.Printf("[Warning] error parsing certificate in certificate pool: %v\n", err)
				break
			}
			s.IdentityCertPool.AddCert(cert)
		}
	}

	certRaw, err := ioutil.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("error loading identity certificate: %v", err)
	}

	s.identityCertificate, err = x509.ParseCertificate(certRaw)
	if err != nil {
		return nil, fmt.Errorf("error parsing identity certificate: %v", err)
	}

	keyRaw, err := ioutil.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("error loading identity key: %v", err)
	}

	s.identityPrivateKey, err = x509.ParsePKCS1PrivateKey(keyRaw)
	if err != nil {
		return nil, fmt.Errorf("error parsing identity private key: %v", err)
	}

	return s, nil
}
