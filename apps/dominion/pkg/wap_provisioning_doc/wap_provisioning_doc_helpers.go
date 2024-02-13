package wap

import (
	"crypto/sha1"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

// ROBORenewPeriod is the amount of days before a certificate expires to begin automatic renewal
const ROBORenewPeriod = 42

// ROBORetryInterval is the amount of days between trying an automatic certificate renewal
const ROBORetryInterval = 4

// DefaultPollCharacteristic is a default "Poll" characteristic with default parameter set.
// This characteristic is for use with the DMClient characteristics.
var DefaultPollCharacteristic = Characteristic{
	Type: "Poll",
	Params: []Parameter{
		{
			Name:     "IntervalForFirstSetOfRetries",
			Value:    "3",
			DataType: "integer",
		},
		{
			Name:     "NumberOfFirstRetries",
			Value:    "5",
			DataType: "integer",
		},
		{
			Name:     "IntervalForSecondSetOfRetries",
			Value:    "15",
			DataType: "integer",
		},
		{
			Name:     "NumberOfSecondRetries",
			Value:    "8",
			DataType: "integer",
		},
		{
			Name:     "IntervalForRemainingScheduledRetries",
			Value:    "480",
			DataType: "integer",
		},
		{
			Name:     "NumberOfRemainingScheduledRetries",
			Value:    "0",
			DataType: "integer",
		},
		{
			Name:     "PollOnLogin",
			Value:    "true",
			DataType: "boolean",
		},
		{
			Name:     "AllUsersPollOnFirstLogin",
			Value:    "true",
			DataType: "boolean",
		},
	},
}

// NewProvisioningDoc creates a new WAP Provisioning document
func NewProvisioningDoc(characteristics []Characteristic) ProvisioningDoc {
	if characteristics == nil {
		characteristics = []Characteristic{}
	}

	return ProvisioningDoc{
		Version:        "1.1",
		Characteristic: characteristics,
	}
}

// NewCertStore creates a new "CertificateStore" characteristic
func NewCertStore(identityRootCertificate *x509.Certificate, certStore string, clientIssuedCertificateRaw []byte) Characteristic {
	var roboParms = []Parameter{
		{
			Name:     "ROBOSupport",
			Value:    "true",
			DataType: "boolean",
		},

		{
			Name:     "RenewPeriod",
			Value:    fmt.Sprintf("%v", ROBORenewPeriod),
			DataType: "integer",
		},
		{
			Name:     "RetryInterval",
			Value:    fmt.Sprintf("%v", ROBORetryInterval),
			DataType: "integer",
		},
	}

	return Characteristic{
		Type: "CertificateStore",
		Characteristics: []Characteristic{
			{
				Type: "Root",
				Characteristics: []Characteristic{
					{
						Type: "System",
						Characteristics: []Characteristic{
							{
								Type: strings.ToUpper(fmt.Sprintf("%x", sha1.Sum(identityRootCertificate.Raw))),
								Params: []Parameter{
									{
										Name:  "EncodedCertificate",
										Value: base64.StdEncoding.EncodeToString(identityRootCertificate.Raw),
									},
								},
							},
						},
					},
				},
			},
			{
				Type: "My",
				Characteristics: []Characteristic{
					{
						Type: certStore,
						Characteristics: []Characteristic{
							{
								Type: strings.ToUpper(fmt.Sprintf("%x", sha1.Sum(clientIssuedCertificateRaw))),
								Params: []Parameter{
									{
										Name:  "EncodedCertificate",
										Value: base64.StdEncoding.EncodeToString(clientIssuedCertificateRaw),
									},
								},
							},
							{
								Type: "PrivateKeyContainer",
								Params: []Parameter{
									{
										Name:  "KeySpec",
										Value: "2",
									},
									{
										Name:  "ContainerName",
										Value: "ConfigMgrEnrollment",
									},
									{
										Name:  "ProviderType",
										Value: "1",
									},
								},
							},
						},
					},
					{
						Type: "WSTEP",
						Characteristics: []Characteristic{
							{
								Type:   "Renew",
								Params: roboParms,
							},
						},
					},
				},
			},
		},
	}
}

// NewW7Application creates a new "w7 APPLICATION" characteristic
func NewW7Application(providerID, name, managementServiceURL, sslClientCertSearchCriteria string) Characteristic {
	return Characteristic{
		Type: "APPLICATION",
		Params: []Parameter{
			{
				Name:  "APPID",
				Value: "w7",
			},
			{
				Name:  "PROVIDER-ID",
				Value: providerID,
			},
			{
				Name:  "ADDR",
				Value: managementServiceURL,
			},
			{
				Name:  "NAME",
				Value: name,
			},
			{
				Name: "BACKCOMPATRETRYDISABLED",
			},
			{
				Name:  "CONNRETRYFREQ",
				Value: "6",
			},
			{
				Name:  "DEFAULTENCODING",
				Value: "application/vnd.syncml.dm+xml",
			},
			{
				Name:  "INITIALBACKOFFTIME",
				Value: TimeInMiliseconds(30 * time.Second),
			},
			{
				Name:  "MAXBACKOFFTIME",
				Value: TimeInMiliseconds(120 * time.Second),
			},
			{
				Name:  "SSLCLIENTCERTSEARCHCRITERIA",
				Value: sslClientCertSearchCriteria,
			},
		},
		Characteristics: []Characteristic{
			{
				Type: "APPAUTH",
				Params: []Parameter{
					{
						Name:  "AAUTHLEVEL",
						Value: "CLIENT",
					},
					{
						Name:  "AAUTHTYPE",
						Value: "DIGEST",
					},
					{
						Name:  "AAUTHSECRET",
						Value: "dummy",
					},
					{
						Name:  "AAUTHDATA",
						Value: "nonce",
					},
				},
			},
			{
				Type: "APPAUTH",
				Params: []Parameter{
					{
						Name:  "AAUTHLEVEL",
						Value: "APPSRV",
					},
					{
						Name:  "AAUTHTYPE",
						Value: "DIGEST",
					},
					{
						Name:  "AAUTHNAME",
						Value: "dummy",
					},
					{
						Name:  "AAUTHSECRET",
						Value: "dummy",
					},
					{
						Name:  "AAUTHDATA",
						Value: "nonce",
					},
				},
			},
		},
	}
}

// NewEmptyApplication creates a new "APPLICATION" characteristic
func NewEmptyApplication(providerID string) Characteristic {
	return Characteristic{
		Type: "APPLICATION",
		Params: []Parameter{
			{
				Name:  "PROVIDER-ID",
				Value: providerID,
			},
		},
	}
}

// NewDMClient creates a new "DMClient" characteristic
func NewDMClient(providerID string, providerParameters []Parameter, providerCharacteristics []Characteristic) Characteristic {
	return Characteristic{
		Type: "DMClient",
		Characteristics: []Characteristic{
			{
				Type: "Provider",
				Characteristics: []Characteristic{
					{
						Type:            providerID,
						Params:          providerParameters,
						Characteristics: providerCharacteristics,
					},
				},
			},
		},
	}
}

// TimeInMiliseconds converts a duration into a time string
func TimeInMiliseconds(d time.Duration) string {
	return fmt.Sprintf("%d", d/time.Millisecond)
}
