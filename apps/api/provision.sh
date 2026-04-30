#!/usr/bin/env bash
set -euo pipefail

# Cloudflare mTLS BYO-CA Provisioning Script
#
# Requirements:
#   - openssl, curl, python3
#   - CLOUDFLARE_API_TOKEN with permissions:
#       Zone:Read, SSL and Certificates:Write, Zone WAF:Write
#
# Note: BYO-CA for mTLS requires an Enterprise Cloudflare plan.

HOSTNAME="mtls-test.otbeaumont.me"
ZONE_NAME="otbeaumont.me"
API_BASE="https://api.cloudflare.com/client/v4"

command -v openssl >/dev/null 2>&1 || { echo "Error: openssl is required"; exit 1; }
command -v curl    >/dev/null 2>&1 || { echo "Error: curl is required";    exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required"; exit 1; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN environment variable is required}"

trap 'rm -f ca.cnf client.cnf client-ext.cnf client-csr.pem ca-cert.srl' EXIT

cf_api() {
    local response
    response=$(curl -s --fail-with-body \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        "$@") || { echo "curl error" >&2; return 1; }
    python3 -c '
import sys, json
d = json.load(sys.stdin)
if not d.get("success"):
    print("API Error:", json.dumps(d), file=sys.stderr)
    sys.exit(1)
print(json.dumps(d))
' <<< "$response"
}

json_get() {
    python3 -c "import sys,json; print(json.load(sys.stdin)${2})" <<< "$1"
}

echo "==> Looking up zone '$ZONE_NAME'..."
ZONE_RESP=$(cf_api "$API_BASE/zones?name=$ZONE_NAME")
read -r ZONE_ID ACCOUNT_ID < <(python3 -c '
import sys, json
r = json.load(sys.stdin)["result"][0]
print(r["id"], r["account"]["id"])
' <<< "$ZONE_RESP")
echo "    Zone ID:    $ZONE_ID"
echo "    Account ID: $ACCOUNT_ID"

echo "==> Generating keys..."
umask 077
openssl genrsa -out ca-key.pem 4096 &
openssl genrsa -out client-key.pem 2048 &
wait

echo "==> Generating root CA certificate..."
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

echo "==> Uploading CA certificate to Cloudflare..."
CERT_PAYLOAD=$(python3 -c '
import json
cert = open("ca-cert.pem").read()
print(json.dumps({"ca": True, "certificates": cert, "name": "mattrax-mtls-ca"}))
')
CERT_RESP=$(cf_api -d "$CERT_PAYLOAD" "$API_BASE/accounts/$ACCOUNT_ID/mtls_certificates")
CERT_ID=$(json_get "$CERT_RESP" '["result"]["id"]')
echo "    CA Certificate ID: $CERT_ID"

echo "==> Associating hostname '$HOSTNAME' with CA..."
ASSOC_PAYLOAD=$(HOSTNAME="$HOSTNAME" CERT_ID="$CERT_ID" python3 -c '
import json, os
print(json.dumps({"hostnames": [os.environ["HOSTNAME"]], "mtls_certificate_id": os.environ["CERT_ID"]}))
')
cf_api -X PUT -d "$ASSOC_PAYLOAD" \
    "$API_BASE/zones/$ZONE_ID/certificate_authorities/hostname_associations" > /dev/null
echo "    Hostname associated."

echo "==> Creating WAF custom rule..."
RULESETS_RESP=$(cf_api "$API_BASE/zones/$ZONE_ID/rulesets")
RULESET_ID=$(python3 -c '
import sys, json
for r in json.load(sys.stdin)["result"]:
    if r.get("phase") == "http_request_firewall_custom" and r.get("kind") == "zone":
        print(r["id"])
        break
' <<< "$RULESETS_RESP")

RULE_PAYLOAD=$(HOSTNAME="$HOSTNAME" python3 -c '
import json, os
h = os.environ["HOSTNAME"]
print(json.dumps({
    "action": "block",
    "expression": f"(http.host eq \"{h}\" and not cf.tls_client_auth.cert_verified)",
    "description": f"Enforce mTLS for {h}"
}))
')

if [ -n "$RULESET_ID" ]; then
    echo "    Adding rule to existing ruleset $RULESET_ID..."
    cf_api -d "$RULE_PAYLOAD" \
        "$API_BASE/zones/$ZONE_ID/rulesets/$RULESET_ID/rules" > /dev/null
else
    echo "    Creating new WAF ruleset with rule..."
    RULESET_PAYLOAD=$(python3 -c '
import json, sys
rule = json.loads(sys.argv[1])
print(json.dumps({
    "kind": "zone",
    "phase": "http_request_firewall_custom",
    "name": "default",
    "description": "Custom rules",
    "rules": [rule]
}))
' "$RULE_PAYLOAD")
    cf_api -d "$RULESET_PAYLOAD" "$API_BASE/zones/$ZONE_ID/rulesets" > /dev/null
fi
echo "    Rule created."

echo "==> Generating test client certificate..."
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
