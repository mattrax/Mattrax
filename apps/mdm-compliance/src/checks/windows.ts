import assert from "node:assert/strict";
import type { Check } from "../types.ts";
import {
  createWindowsHarness,
  windowsDiscoveryBody,
  windowsDiscoveryResponse,
  windowsEnrollBody,
  windowsEnrollmentResponse,
  windowsPolicyBody,
  windowsPolicyResponse,
  windowsPost,
  windowsSoapEnvelope,
  windowsSyncMLBody,
  windowsSyncMLResponse,
} from "../harness/windows.ts";

const tenantToken = "mttxw-compliance";

const check = (
  id: string,
  category: Check["category"],
  name: string,
  description: string,
  run: Check["run"],
  dayN = false,
): Check => ({
  id: `windows.${id}`,
  platform: "windows",
  category,
  name,
  description,
  ...(dayN ? { dayN: true } : {}),
  run,
});

const provisioningXml = (content: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, "")), (character) => character.charCodeAt(0)),
  );

export const windowsChecks: ReadonlyArray<Check> = [
  check(
    "discovery.success",
    "enrollment",
    "Discovery returns policy and enrollment service URLs",
    "A valid Discover request must return auth policy, enrollment version and both service URLs.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/discovery", windowsSoapEnvelope(windowsDiscoveryBody()), {
          tenantToken,
        }),
      );

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /application\/soap\+xml/);
      const body = await windowsDiscoveryResponse(response);
      assert.equal(body.discoverResult.authPolicy, "OnPremise");
      assert.equal(body.discoverResult.enrollmentVersion, "4.0");
      assert.match(body.discoverResult.enrollmentPolicyServiceUrl, /\/mdm\/windows\/policy$/);
      assert.match(body.discoverResult.enrollmentServiceUrl, /\/mdm\/windows\/enroll$/);
      assert.equal(harness.state.discovery[0]?.tenantToken, tenantToken);
    },
  ),
  check(
    "discovery.default-urls",
    "enrollment",
    "Discovery falls back to local service URLs",
    "The server must supply policy and enroll URLs even when the backend omits them.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.discoveryResponse = {
        authPolicy: "OnPremise",
        enrollmentVersion: "4.0",
        enrollmentPolicyServiceUrl: "",
        enrollmentServiceUrl: "",
      };

      const response = await harness.handler(
        windowsPost("/mdm/windows/discovery", windowsSoapEnvelope(windowsDiscoveryBody())),
      );

      const body = await windowsDiscoveryResponse(response);
      assert.equal(
        body.discoverResult.enrollmentPolicyServiceUrl,
        `${harness.origin}/mdm/windows/policy`,
      );
      assert.equal(
        body.discoverResult.enrollmentServiceUrl,
        `${harness.origin}/mdm/windows/enroll`,
      );
    },
  ),
  check(
    "discovery.failure",
    "errors",
    "Discovery backend failure becomes a SOAP fault",
    "An invalid tenant link must return a SOAP fault with an actionable message, not an unhandled exception.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.discoveryError = "unknown";

      const response = await harness.handler(
        windowsPost("/mdm/windows/discovery", windowsSoapEnvelope(windowsDiscoveryBody())),
      );

      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /enrollment link is invalid or has expired/);
    },
  ),
  check(
    "discovery.malformed",
    "errors",
    "Malformed discovery XML returns a SOAP fault",
    "Invalid SOAP XML must be reported as a fault instead of a transport error.",
    async () => {
      const harness = createWindowsHarness();
      const response = await harness.handler(windowsPost("/mdm/windows/discovery", "<not-soap>"));
      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Invalid SOAP request/);
    },
  ),
  check(
    "policy.success",
    "certificates",
    "Policy returns key size, validity and renewal windows",
    "GetPolicies must advertise RSA key length, certificate validity, renewal period and auto-enrollment permission.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost(
          "/mdm/windows/policy",
          windowsSoapEnvelope(windowsPolicyBody(), { security: "policy-token" }),
          { tenantToken },
        ),
      );

      assert.equal(response.status, 200);
      const body = await windowsPolicyResponse(response);
      const policy = body.response.policies.policy;
      assert.equal(policy.attributes.privateKeyAttributes.minimalKeyLength, "2048");
      assert.equal(policy.attributes.certificateValidity.validityPeriodSeconds, "31536000");
      assert.equal(policy.attributes.certificateValidity.renewalPeriodSeconds, "18144000");
      assert.equal(policy.attributes.permission.enroll, "true");
      assert.equal(policy.attributes.permission.autoEnroll, "false");
      assert.ok(body.oIDs.oID.some((oid) => oid.defaultName === "szOID_NIST_sha256"));
      assert.equal(harness.state.policy[0]?.authToken, "policy-token");
      assert.equal(harness.state.policy[0]?.tenantToken, tenantToken);
    },
  ),
  check(
    "policy.missing-token",
    "errors",
    "Policy without BinarySecurityToken is rejected",
    "The policy endpoint must not issue a policy without the authentication token.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost(
          "/mdm/windows/policy",
          windowsSoapEnvelope(windowsPolicyBody(), { security: null }),
        ),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Missing binary security token/);
    },
  ),
  check(
    "policy.malformed",
    "errors",
    "Malformed GetPolicies returns a SOAP fault",
    "A syntactically valid SOAP envelope with an invalid body must produce a policy fault.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/policy", windowsSoapEnvelope("<GetPolicies/>")),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Invalid policy request/);
    },
  ),
  check(
    "policy.backend-failure",
    "errors",
    "Policy backend failure becomes a SOAP fault",
    "An unknown policy token must produce a curated fault with an enrollment recovery step.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.policyError = "unknown";

      const response = await harness.handler(
        windowsPost("/mdm/windows/policy", windowsSoapEnvelope(windowsPolicyBody())),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /enrollment link is invalid or has expired/);
    },
  ),
  check(
    "enroll.success",
    "enrollment",
    "Enrollment issues a provisioning document",
    "WSTEP enrollment must return RequestSecurityTokenResponseCollection containing a base64 WAP provisioning document.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/enroll", windowsSoapEnvelope(windowsEnrollBody()), {
          tenantToken,
        }),
      );

      assert.equal(response.status, 200);
      const body = await windowsEnrollmentResponse(response);
      const token = body.requestSecurityTokenResponse.requestedSecurityToken.binarySecurityToken;
      assert.match(token.valueType, /DeviceEnrollmentProvisionDoc$/);
      assert.match(token.encodingType, /base64(binary)?$/i);
      const provisioning = provisioningXml(token.content);
      assert.match(provisioning, /wap-provisioningdoc/);
      assert.match(provisioning, /PROVIDER-ID/);
      assert.match(provisioning, /Compliance/);
      assert.match(provisioning, /mdm\/windows\/management/);
      assert.equal(harness.state.enrollments[0]?.deviceId, "windows-device-1");
      assert.equal(harness.state.enrollments[0]?.tenantToken, tenantToken);
    },
  ),
  check(
    "enroll.management-url",
    "enrollment",
    "Provisioning document preserves the tenant token",
    "The management URL in the provisioning document must carry the tenant token so an unauthenticated device can resolve its tenant.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/enroll", windowsSoapEnvelope(windowsEnrollBody()), {
          tenantToken,
        }),
      );

      const body = await windowsEnrollmentResponse(response);

      const provisioning = provisioningXml(
        body.requestSecurityTokenResponse.requestedSecurityToken.binarySecurityToken.content,
      );

      assert.match(provisioning, new RegExp(`mdm/windows/management\\?tenant=${tenantToken}`));
    },
  ),
  check(
    "enroll.missing-token",
    "errors",
    "Enrollment without BinarySecurityToken is rejected",
    "WSTEP must not create an identity without the authentication token.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost(
          "/mdm/windows/enroll",
          windowsSoapEnvelope(windowsEnrollBody(), { security: null }),
        ),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Missing binary security token/);
    },
  ),
  check(
    "enroll.malformed",
    "errors",
    "Malformed enrollment request returns a SOAP fault",
    "A malformed RequestSecurityToken must not create a device identity.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost(
          "/mdm/windows/enroll",
          windowsSoapEnvelope(
            '<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"/>',
          ),
        ),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Invalid enrollment request/);
    },
  ),
  check(
    "enroll.backend-failure",
    "errors",
    "Enrollment backend failure becomes a SOAP fault",
    "An expired onboarding credential must return a fault rather than a provisioning document.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.enrollmentError = "unknown";

      const response = await harness.handler(
        windowsPost("/mdm/windows/enroll", windowsSoapEnvelope(windowsEnrollBody())),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /enrollment link is invalid or has expired/);
    },
  ),
  check(
    "management.success",
    "management",
    "SyncML session acknowledges commands and returns work",
    "A management request must return SyncHdr status 200, acknowledgements and backend Get/Replace/Exec commands.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.managementResponse = {
        commands: [
          { kind: "Get", cmdID: "10", locURI: "./DevInfo/DevId" },
          {
            kind: "Replace",
            cmdID: "11",
            locURI: "./DevDetail/Ext/Microsoft/DeviceName",
            data: "DESKTOP-COMPLIANCE",
            format: "chr",
          },
          {
            kind: "Exec",
            cmdID: "12",
            locURI: "./Device/Vendor/MSFT/RemoteWipe/doWipe",
          },
        ],
      };

      const response = await harness.handler(
        windowsPost("/mdm/windows/management", windowsSyncMLBody(), { tenantToken }),
      );

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /syncml/);
      const message = await windowsSyncMLResponse(response);
      assert.equal(message.syncHdr.sessionID, "session-1");
      assert.equal(message.syncHdr.msgID, "1");
      assert.equal(message.syncHdr.target.locURI, "windows-device-1");
      assert.equal(
        message.syncHdr.source.locURI,
        "https://mdm.example.test/mdm/windows/management",
      );
      assert.deepEqual(
        message.syncBody.status?.slice(0, 2).map((status) => ({
          cmd: status.cmd,
          cmdRef: status.cmdRef,
          data: status.data,
        })),
        [
          { cmd: "SyncHdr", cmdRef: "0", data: "200" },
          { cmd: "Alert", cmdRef: "2", data: "200" },
        ],
      );
      assert.equal(message.syncBody.get?.[0]?.items?.[0]?.target?.locURI, "./DevInfo/DevId");
      assert.equal(
        message.syncBody.replace?.[0]?.items?.[0]?.target?.locURI,
        "./DevDetail/Ext/Microsoft/DeviceName",
      );
      assert.equal(
        message.syncBody.exec?.[0]?.items?.[0]?.target?.locURI,
        "./Device/Vendor/MSFT/RemoteWipe/doWipe",
      );
      assert.ok(message.syncBody.final);
      assert.equal(harness.state.management[0]?.scope.deviceId, "windows-device-1");
      assert.equal(harness.state.management[0]?.scope.tenantToken, tenantToken);
      assert.equal(harness.state.events[0]?.event._tag, "ManagementCheckin");
    },
  ),
  check(
    "management.replace-ack",
    "management",
    "Replace command is acknowledged with its CmdRef",
    "Every inbound SyncML command must be acknowledged with the matching command name and CmdRef.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/management", windowsSyncMLBody({ command: "replace" })),
      );

      const message = await windowsSyncMLResponse(response);
      const acknowledgement = message.syncBody.status?.find((status) => status.cmdRef === "2");
      assert.ok(acknowledgement);
      assert.equal(acknowledgement.cmd, "Replace");
      assert.equal(acknowledgement.data, "200");
    },
  ),
  check(
    "management.exec-ack",
    "management",
    "Exec command is acknowledged with its CmdRef",
    "Remote actions must be acknowledged without the server inventing a different command reference.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/management", windowsSyncMLBody({ command: "exec" })),
      );

      const message = await windowsSyncMLResponse(response);
      const acknowledgement = message.syncBody.status?.find((status) => status.cmdRef === "2");
      assert.ok(acknowledgement);
      assert.equal(acknowledgement.cmd, "Exec");
    },
  ),
  check(
    "management.malformed",
    "errors",
    "Malformed SyncML returns a SOAP fault",
    "A non-SyncML management body must return a fault instead of an empty response.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/management", "<SyncML><broken>"),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Invalid SyncML request/);
    },
  ),
  check(
    "management.backend-failure",
    "errors",
    "Management backend failure becomes a SOAP fault",
    "A failed management check-in must be reported as a fault to the device.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.managementError = "unsupported";

      const response = await harness.handler(
        windowsPost("/mdm/windows/management", windowsSyncMLBody()),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /Management backend failed/);
    },
  ),
  check(
    "management.unknown-device",
    "errors",
    "Unknown device gets an actionable enrollment fault",
    "An unknown or revoked Windows device identity must not receive management commands.",
    async () => {
      const harness = createWindowsHarness();
      harness.state.managementError = "unknown";

      const response = await harness.handler(
        windowsPost("/mdm/windows/management", windowsSyncMLBody()),
      );

      const text = await response.text();
      assert.match(text, /Fault/);
      assert.match(text, /enrollment link is invalid or has expired/);
      assert.equal(harness.state.management.length, 0);
    },
  ),
  check(
    "day-n.renewal-window",
    "day-n",
    "Renewal window is shorter than certificate validity",
    "Windows auto-enrollment needs a positive renewal period strictly before certificate expiry.",
    async () => {
      const harness = createWindowsHarness();

      const response = await harness.handler(
        windowsPost("/mdm/windows/policy", windowsSoapEnvelope(windowsPolicyBody())),
      );

      const body = await windowsPolicyResponse(response);

      const validity = Number(
        body.response.policies.policy.attributes.certificateValidity.validityPeriodSeconds,
      );

      const renewal = Number(
        body.response.policies.policy.attributes.certificateValidity.renewalPeriodSeconds,
      );

      assert.ok(renewal > 0);
      assert.ok(renewal < validity);
      assert.ok(validity - renewal >= 24 * 60 * 60);
    },
    true,
  ),
  check(
    "day-n.re-enrollment",
    "day-n",
    "A renewed PKCS#10 request gets a fresh provisioning document",
    "Day-N certificate renewal is a second WSTEP enrollment; the server must accept a new CSR and return a complete provisioning document.",
    async () => {
      const harness = createWindowsHarness();

      const first = await harness.handler(
        windowsPost(
          "/mdm/windows/enroll",
          windowsSoapEnvelope(
            windowsEnrollBody({ csr: "Y3NyLW9uZQ==", deviceId: "windows-device-1" }),
          ),
        ),
      );

      const second = await harness.handler(
        windowsPost(
          "/mdm/windows/enroll",
          windowsSoapEnvelope(
            windowsEnrollBody({ csr: "Y3NyLXR3bw==", deviceId: "windows-device-1" }),
          ),
        ),
      );

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(harness.state.enrollments.length, 2);
      assert.equal(harness.state.enrollments[0]?.csr, "Y3NyLW9uZQ==");
      assert.equal(harness.state.enrollments[1]?.csr, "Y3NyLXR3bw==");
      const body = await windowsEnrollmentResponse(second);

      const provisioning = provisioningXml(
        body.requestSecurityTokenResponse.requestedSecurityToken.binarySecurityToken.content,
      );

      assert.match(provisioning, /mdm\/windows\/management/);
    },
    true,
  ),
];
