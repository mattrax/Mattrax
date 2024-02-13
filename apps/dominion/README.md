# Dominion

Dominion is the Mobile Device Management (MDM) server for the Mattrax platform. It is responsible for enrolling devices, pull data from them and pushing configuration to them.

## Code Overview

`cmd\*`: Check environment configuration, initialise services, mount HTTP routes to router, serve HTTP server with production ready configuration
`internal\api\*`: This folder contains the code to talk with the Mattrax API.
`internal\certificates\*`: General helpers for certificate issuing
`internal\enrollment\*`: The HTTP handlers for enrollment phase
`internal\management\*`: The HTTP handlers for management phase
`internal\server.go`: The `internal.Server` struct which allows parsing all the dependencies around easily
`pkg\soap\*`: Helpers for the SOAP protocol (Used for enrollment requests & responses)
`pkg\syncml\*`: Helpers for the SyncML protocol (Used to management)
`pkg\wap_provisioning_doc\*`: Helpers for the WAP Provisioning Document generation. This configures the MDM client as part of enrollment.
`pkg\get_named_route.go`: Helper to find the path of a named HTTP handler using the `gorilla/mux` router

## Certificates

If this is the first deploy follow the steps below. If you are renewing the certificates; backup the existing ones then delete `./certs/identity.crt` and `./certs/identity.key` and follow the process below.

```bash
mkdir certs # If it doesn't exist
openssl req -x509 -newkey rsa:4096 -keyout identity.key.pem -out identity.crt.pem -days 1095 -config openssl.cnf
openssl x509 -outform der -in identity.crt.pem -out ./certs/identity.crt
openssl rsa -in identity.key.pem -outform DER -out ./certs/identity.key
cat identity.crt.pem >> ./certs/identity.pool
```

The certificates can be removed from the `./certs/identity.pool` file when the expire, it is intended that multiple valid certificate may be the certificate pool at once.

## Configuration

The server is configured using environment variables. Please refer to the following table for the required values and their usage.

| Varible                        | Usage                                                                                   | Example Value                       |
| ------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------- |
| DOMAIN                         | The primary domain name for the MDM server used for enrollment                          | `mdm.example.com`                   |
| MANAGEMENT_DOMAIN              | The domain name used for management                                                     | `mdm.example.com:8443`              |
| API_DOMAIN                     | The base url of the backend API                                                         | `https://cloud.mattrax.app/api/mdm` |
| TLS_CERT_PATH                  | The filesystem path to the TLS certificate                                              | `./certs/tls.crt`                   |
| TLS_KEY_PATH                   | The filesystem path to the TLS certificate's key                                        | `./certs/tls.key`                   |
| IDENTITY_CERT_POOL_PATH        | The filesystem path to the identity certificate pool                                    | `./certs/identity.pool`             |
| IDENTITY_CERT_PATH             | The filesystem path to the active identity certificate                                  | `./certs/identity.crt`              |
| IDENTITY_KEY_PATH              | The filesystem path to the active identity certificate key                              | `./certs/identity.key`              |
| IDENTITY_KEY_PASSWORD          | The password to the active identity certificate key                                     | `password`                          |
| DISABLE_CERT_RENEW_ELIGIBILITY | When set to true the device certificate can be renewed at any time. ONLY for debugging. | `false`                             |
| DEBUG                          | When set to true requests will be logged. ONLY for debugging.                           | `false`                             |

## Usage

```bash
go build -o dominion ./cmd
./dominion
```

## Current Method to Run

1. Run the server certificate generation commands as shown above.
2. Define the environment varibles as shown in configuration section above.
3. Run the server as shown in the usage section above
4. To enroll a device currently you must right click on the desktop of the device and click "New" then "Shortcut". Put this url replacing the servername with your own as defined in the configuration above `ms-device-enrollment:?mode=mdm&servername=mdm.example.com`. Then launch the shortcut.