#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Cloudflare mTLS BYO-CA Provisioning Script
# =============================================================================
# This script:
#   1. Generates a self-signed root CA with OpenSSL
#   2. Uploads the CA to Cloudflare (account-level mTLS certificate)
#   3. Associates the CA with mtls-test.otbeaumont.me
#   4. Creates a WAF custom rule to enforce client certificates for that host
#   5. Generates a test client certificate signed by the CA
#
# Requirements:
#   - openssl, curl, python3
#   - CLOUDFLARE_API_TOKEN environment variable with these permissions:
#       * Zone:Read          (lookup zone)
#       * SSL and Certificates:Write  (upload CA + hostname associations)
#       * Zone WAF:Write     (create custom rule)
#
# Note: Bring Your Own CA for mTLS requires an Enterprise Cloudflare plan.
# =============================================================================

HOSTNAME="mtls-test.otbeaumont.me"
ZONE_NAME="otbeaumont.me"
API_BASE="https://api.cloudflare.com/client/v4"

# --- Pre-flight checks --------------------------------------------------------

command -v openssl >/dev/null 2>&1 || { echo "Error: openssl is required"; exit 1; }
command -v curl    >/dev/null 2>&1 || { echo "Error: curl is required";    exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required"; exit 1; }

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN environment variable is required"
    exit 1
fi

# --- Helper -------------------------------------------------------------------

cf_api() {
    local response
    response=$(curl -s \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        "$@")

    if [ "$(echo "$response" | python3 -c 'import sys,json; print("true" if json.load(sys.stdin).get("success") else "false")')" != "true" ]; then
        echo "API Error: $response" >&2
        return 1
    fi
    echo "$response"
}

# --- Step 1: Resolve zone & account IDs ---------------------------------------

echo "==> Looking up zone '$ZONE_NAME'..."
ZONE_RESP=$(cf_api "$API_BASE/zones?name=$ZONE_NAME")
ZONE_ID=$(echo "$ZONE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"][0]["id"])')
ACCOUNT_ID=$(echo "$ZONE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"][0]["account"]["id"])')

echo "    Zone ID:    $ZONE_ID"
echo "    Account ID: $ACCOUNT_ID"

# --- Step 2: Generate root CA -------------------------------------------------

echo "==> Generating root CA..."

openssl genrsa -out ca-key.pem 4096
chmod 600 ca-key.pem

cat > ca.cnf << 'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
[req_distinguished_name]
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
EOF

openssl req -new -x509 -days 3650 -sha256 \
    -key ca-key.pem -out ca-cert.pem \
    -config ca.cnf \
    -subj "/C=AU/O=Mattrax/CN=Mattrax mTLS Root CA"

rm ca.cnf

# --- Step 3: Upload CA to Cloudflare ------------------------------------------

echo "==> Uploading CA certificate to Cloudflare..."

CERT_PAYLOAD=$(python3 << PYEOF
import json
with open("ca-cert.pem") as f:
    cert = f.read()
print(json.dumps({"ca": True, "certificates": cert, "name": "mattrax-mtls-ca"}))
PYEOF
)

CERT_RESP=$(cf_api -d "$CERT_PAYLOAD" "$API_BASE/accounts/$ACCOUNT_ID/mtls_certificates")
CERT_ID=$(echo "$CERT_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["id"])')

echo "    CA Certificate ID: $CERT_ID"

# --- Step 4: Associate hostname with the CA -----------------------------------

echo "==> Associating hostname '$HOSTNAME' with CA..."

ASSOC_PAYLOAD=$(python3 << PYEOF
import json
print(json.dumps({
    "hostnames": ["$HOSTNAME"],
    "mtls_certificate_id": "$CERT_ID"
}))
PYEOF
)

cf_api -X PUT -d "$ASSOC_PAYLOAD" \
    "$API_BASE/zones/$ZONE_ID/certificate_authorities/hostname_associations"

echo "    Hostname associated."

# --- Step 5: Create WAF custom rule to enforce mTLS ---------------------------

echo "==> Creating WAF custom rule..."

RULESETS_RESP=$(cf_api "$API_BASE/zones/$ZONE_ID/rulesets")
RULESET_ID=$(echo "$RULESETS_RESP" | python3 -c '
import sys, json
for r in json.load(sys.stdin)["result"]:
    if r.get("phase") == "http_request_firewall_custom" and r.get("kind") == "zone":
        print(r["id"])
        break
')

RULE_PAYLOAD=$(python3 << PYEOF
import json
print(json.dumps({
    "action": "block",
    "expression": '(http.host eq "$HOSTNAME" and not cf.tls_client_auth.cert_verified)',
    "description": "Enforce mTLS for $HOSTNAME"
}))
PYEOF
)

if [ -n "$RULESET_ID" ]; then
    echo "    Adding rule to existing ruleset $RULESET_ID..."
    cf_api -d "$RULE_PAYLOAD" \
        "$API_BASE/zones/$ZONE_ID/rulesets/$RULESET_ID/rules"
else
    echo "    Creating new WAF ruleset with rule..."
    RULESET_PAYLOAD=$(python3 << PYEOF
import json
print(json.dumps({
    "kind": "zone",
    "phase": "http_request_firewall_custom",
    "name": "default",
    "description": "Custom rules",
    "rules": [{
        "action": "block",
        "expression": '(http.host eq "$HOSTNAME" and not cf.tls_client_auth.cert_verified)',
        "description": "Enforce mTLS for $HOSTNAME"
    }]
}))
PYEOF
    )
    cf_api -d "$RULESET_PAYLOAD" "$API_BASE/zones/$ZONE_ID/rulesets"
fi

echo "    Rule created."

# --- Step 6: Generate a test client certificate -------------------------------

echo "==> Generating test client certificate..."

openssl genrsa -out client-key.pem 2048
chmod 600 client-key.pem

cat > client.cnf << 'EOF'
[req]
distinguished_name = req_distinguished_name
[req_distinguished_name]
EOF

openssl req -new -key client-key.pem -out client-csr.pem \
    -config client.cnf \
    -subj "/C=AU/O=Mattrax/CN=test-client"

cat > client-ext.cnf << 'EOF'
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -in client-csr.pem -sha256 \
    -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
    -out client-cert.pem -days 365 \
    -extfile client-ext.cnf

rm client.cnf client-csr.pem client-ext.cnf

# --- Summary ------------------------------------------------------------------

echo ""
echo "============================================================================="
echo "Done! mTLS has been configured for $HOSTNAME"
echo "============================================================================="
echo ""
echo "Generated files:"
echo "  ca-cert.pem      - Root CA certificate (uploaded to Cloudflare)"
echo "  ca-key.pem       - Root CA private key (keep secure!)"
echo "  client-cert.pem  - Test client certificate"
echo "  client-key.pem   - Test client private key"
echo ""
echo "Test with curl:"
echo "  curl --cert client-cert.pem --key client-key.pem https://$HOSTNAME"
echo ""
echo "Without a client certificate, requests will be blocked with HTTP 403."
echo ""
