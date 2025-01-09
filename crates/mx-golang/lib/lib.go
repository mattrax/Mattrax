package main

import (
	"bufio"
	"bytes"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"math/big"
	"os"

	"github.com/smallstep/pkcs7"
)

// SCEP OIDs
var (
	oidSCEPmessageType    = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 2}
	oidSCEPpkiStatus      = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 3}
	oidSCEPfailInfo       = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 4}
	oidSCEPsenderNonce    = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 5}
	oidSCEPrecipientNonce = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 6}
	oidSCEPtransactionID  = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 7}
)

// The MessageType attribute specifies the type of operation performed
// by the transaction.  This attribute MUST be included in all PKI
// messages.
//
// The following message types are defined:
type MessageType string

// Undefined message types are treated as an error.
const (
	CertRep    MessageType = "3"
	RenewalReq MessageType = "17"
	UpdateReq  MessageType = "18"
	PKCSReq    MessageType = "19"
	CertPoll   MessageType = "20"
	GetCert    MessageType = "21"
	GetCRL     MessageType = "22"
)

// PKIStatus is a SCEP pkiStatus attribute which holds transaction status information.
// All SCEP responses MUST include a pkiStatus.
//
// The following pkiStatuses are defined:
type PKIStatus string

// Undefined pkiStatus attributes are treated as an error
const (
	SUCCESS PKIStatus = "0"
	FAILURE PKIStatus = "2"
	PENDING PKIStatus = "3"
)

func main() {
	operation := os.Args[1]

	if operation == "pkcs_encrypt" {
		reader := bufio.NewReader(os.Stdin)
		cert_der_json, err := reader.ReadBytes('\n')
		if err != nil {
			panic(err)
		}
		key_der_json, err := reader.ReadBytes('\n')
		if err != nil {
			panic(err)
		}
		csr_der_json, err := reader.ReadBytes('\n')
		if err != nil {
			panic(err)
		}
		p7_certificates_json, err := reader.ReadBytes('\n')
		if err != nil {
			panic(err)
		}
		transaction_id_raw, err := reader.ReadBytes('\n')
		if err != nil {
			panic(err)
		}
		sender_nonce_raw, err := reader.ReadBytes('\n')
		if err != nil {
			panic(err)
		}

		var cert_der []byte
		if err := json.Unmarshal(cert_der_json, &cert_der); err != nil {
			panic(err)
		}

		var key_der []byte
		if err := json.Unmarshal(key_der_json, &key_der); err != nil {
			panic(err)
		}

		var csr_der []byte
		if err := json.Unmarshal(csr_der_json, &csr_der); err != nil {
			panic(err)
		}

		var p7_certificates [][]byte
		if err := json.Unmarshal(p7_certificates_json, &p7_certificates); err != nil {
			panic(err)
		}

		var transaction_id string
		if err := json.Unmarshal(transaction_id_raw, &transaction_id); err != nil {
			panic(err)
		}

		var sender_nonce []byte
		if err := json.Unmarshal(sender_nonce_raw, &sender_nonce); err != nil {
			panic(err)
		}

		cert, err := x509.ParseCertificate(cert_der)
		if err != nil {
			panic(err)
		}
		key, err := x509.ParsePKCS8PrivateKey(key_der)
		if err != nil {
			panic(err)
		}
		crt, err := x509.ParseCertificate(csr_der)
		if err != nil {
			panic(err)
		}
		var p7_certs []*x509.Certificate
		for _, p7_cert := range p7_certificates {
			cert, err := x509.ParseCertificate(p7_cert)
			if err != nil {
				panic(err)
			}
			p7_certs = append(p7_certs, cert)
		}

		// deg, err := DegenerateCertificates([]*x509.Certificate{crt})
		// if err != nil {
		// 	panic(err)
		// }

		// Use value from Rust
		// deg, err := os.ReadFile("pending_stage_1")
		// if err != nil {
		// 	panic(err)
		// }

		// encrypt degenerate data using the original messages recipients
		// pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmAES128CBC
		// e7, err := pkcs7.Encrypt(deg, p7_certs)
		// if err != nil {
		// 	panic(err)
		// }

		// os.WriteFile("stage_e7", e7, os.FileMode(0644))

		// Use value from Rust
		e7, err := os.ReadFile("pending_stage_2")
		if err != nil {
			panic(err)
		}

		// PKIMessageAttributes to be signed
		config := pkcs7.SignerInfoConfig{
			ExtraSignedAttributes: []pkcs7.Attribute{
				{
					Type:  oidSCEPtransactionID,
					Value: transaction_id,
				},
				{
					Type:  oidSCEPpkiStatus,
					Value: SUCCESS,
				},
				{
					Type:  oidSCEPmessageType,
					Value: CertRep,
				},
				{
					Type:  oidSCEPsenderNonce,
					Value: sender_nonce,
				},
				{
					Type:  oidSCEPrecipientNonce,
					Value: sender_nonce,
				},
			},
		}

		signedData, err := pkcs7.NewSignedData(e7)
		if err != nil {
			panic(err)
		}

		// add the certificate into the signed data type
		// this cert must be added before the signedData because the recipient will expect it
		// as the first certificate in the array
		signedData.AddCertificate(crt)
		// sign the attributes
		if err := signedData.AddSigner(cert, key, config); err != nil {
			panic(err)
		}

		certRepBytes, err := signedData.Finish()
		if err != nil {
			panic(err)
		}

		os.Stdout.Write(certRepBytes[:])

		// fmt.Println(certRepBytes)

		// result, err := json.Marshal(certRepBytes)
		// if err != nil {
		// 	panic(err)
		// }
		// fmt.Println(result)
	} else {
		panic("Invalid operation")
	}
}

// DegenerateCertificates creates degenerate certificates PKCS#7 type
func DegenerateCertificates(certs []*x509.Certificate) ([]byte, error) {
	var buf bytes.Buffer
	for _, cert := range certs {
		buf.Write(cert.Raw)
	}
	// degenerate, err := pkcs7.DegenerateCertificate(buf.Bytes())
	// if err != nil {
	// 	return nil, err
	// }
	degenerate, err := DegenerateCertificate(buf.Bytes())
	if err != nil {
		return nil, err
	}
	os.WriteFile("stage_d", degenerate, os.FileMode(0644))
	// return degenerate, nil

	// Use value from Rust
	f, err := os.ReadFile("pending_stage_1")
	if err != nil {
		return nil, err
	}
	return f, nil
}

// Even though, the tag & length are stripped out during marshalling the
// RawContent, we have to encode it into the RawContent. If its missing,
// then `asn1.Marshal()` will strip out the certificate wrapper instead.
func marshalCertificateBytes(certs []byte) (rawCertificates, error) {
	var val = asn1.RawValue{Bytes: certs, Class: 2, Tag: 0, IsCompound: true}
	b, err := asn1.Marshal(val)
	if err != nil {
		return rawCertificates{}, err
	}
	return rawCertificates{Raw: b}, nil
}

// DegenerateCertificate creates a signed data structure containing only the
// provided certificate or certificate chain.
func DegenerateCertificate(cert []byte) ([]byte, error) {
	os.WriteFile("stage_a", cert, os.FileMode(0644))

	rawCert, err := marshalCertificateBytes(cert)
	if err != nil {
		return nil, err
	}

	os.WriteFile("stage_b", rawCert.Raw, os.FileMode(0644))

	emptyContent := contentInfo{ContentType: pkcs7.OIDData}
	sd := signedData{
		Version:      1,
		ContentInfo:  emptyContent,
		Certificates: rawCert,
		CRLs:         []pkix.CertificateList{},
	}
	content, err := asn1.Marshal(sd)
	if err != nil {
		return nil, err
	}

	os.WriteFile("stage_c", content, os.FileMode(0644))

	// // Use value from Rust
	// f, err := os.ReadFile("pending_stage_1")
	// if err != nil {
	// 	return nil, err
	// }
	// content = f

	signedContent := contentInfo{
		ContentType: pkcs7.OIDSignedData,
		Content:     asn1.RawValue{Class: 2, Tag: 0, Bytes: content, IsCompound: true},
	}
	return asn1.Marshal(signedContent)
}

type contentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue `asn1:"explicit,optional,tag:0"`
}

type signedData struct {
	Version                    int                        `asn1:"default:1"`
	DigestAlgorithmIdentifiers []pkix.AlgorithmIdentifier `asn1:"set"`
	ContentInfo                contentInfo
	Certificates               rawCertificates        `asn1:"optional,tag:0"`
	CRLs                       []pkix.CertificateList `asn1:"optional,tag:1"`
	SignerInfos                []signerInfo           `asn1:"set"`
}

type rawCertificates struct {
	Raw asn1.RawContent
}

type signerInfo struct {
	Version                   int `asn1:"default:1"`
	IssuerAndSerialNumber     issuerAndSerial
	DigestAlgorithm           pkix.AlgorithmIdentifier
	AuthenticatedAttributes   []attribute `asn1:"optional,omitempty,tag:0"`
	DigestEncryptionAlgorithm pkix.AlgorithmIdentifier
	EncryptedDigest           []byte
	UnauthenticatedAttributes []attribute `asn1:"optional,omitempty,tag:1"`
}

type attribute struct {
	Type  asn1.ObjectIdentifier
	Value asn1.RawValue `asn1:"set"`
}

type issuerAndSerial struct {
	IssuerName   asn1.RawValue
	SerialNumber *big.Int
}
