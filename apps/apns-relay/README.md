# Standalone APNs relay

**Status: not a supported production deployment target.**

This app is an independent relay kept for development and custom forks. It
implements the HMAC-signed relay protocol with its own `APNS_RELAY_SECRET`,
separate from the hosted `apps/services` deployment and its shared
`SERVICES_TOKEN`.

The application no longer reads `APNS_RELAY_URL`, so there is no supported
operator setting that points Cloud or a self-hosted install at this relay. Only
the internal `MATTRAX_SERVICES_URL` test override can target it. Hosted Cloud
uses `apps/services`; self-hosted deployments use the hosted relay with their
`MATTRAX_LICENSE_KEY`.
