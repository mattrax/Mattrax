package main

import (
	"bufio"
	"bytes"
	"crypto/x509"
	"encoding/asn1"
	"encoding/json"
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

		deg, err := DegenerateCertificates([]*x509.Certificate{crt})
		if err != nil {
			panic(err)
		}

		// encrypt degenerate data using the original messages recipients
		e7, err := pkcs7.Encrypt(deg, p7_certs)
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
	degenerate, err := pkcs7.DegenerateCertificate(buf.Bytes())
	if err != nil {
		return nil, err
	}
	return degenerate, nil
}
