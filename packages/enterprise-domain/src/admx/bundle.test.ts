import { describe, expect, it } from "vitest";
import { buildAdmxCatalogueIndex, parseAdmxBundle } from "./index.js";

const VENDOR_ADMX = `<policyDefinitions revision="1.0" schemaVersion="1.0">
  <policyNamespaces><target prefix="contoso" namespace="Contoso.Policies.CompanyApp" /></policyNamespaces>
  <categories>
    <category name="Root" displayName="$(string.Root)" />
    <category name="Child"><parentCategory ref="Root" /></category>
  </categories>
  <policies>
    <policy name="EnableFeature" class="Machine" displayName="$(string.EnableFeature)" key="Software\\Policies\\Contoso" valueName="EnableFeature">
      <parentCategory ref="Child" />
      <enabledValue><decimal value="1" /></enabledValue>
      <elements><text id="Server" valueName="Server" required="true" /></elements>
    </policy>
    <policy name="UserFeature" class="User" displayName="$(string.UserFeature)" key="Software\\Policies\\Contoso">
      <parentCategory ref="Root" />
    </policy>
  </policies>
</policyDefinitions>`;

const VENDOR_ADML = `<policyDefinitionResources revision="1.0" schemaVersion="1.0">
  <resources>
    <stringTable>
      <string id="Root">Contoso</string>
      <string id="EnableFeature">Enable feature</string>
      <string id="UserFeature">User feature</string>
    </stringTable>
  </resources>
</policyDefinitionResources>`;

const INBOX_ADMX = `<policyDefinitions revision="1.0" schemaVersion="1.0">
  <policyNamespaces><target prefix="srmfci" namespace="Microsoft.Policies.SrmFci" /></policyNamespaces>
  <categories><category name="SrmFci" /></categories>
  <policies>
    <policy name="AccessDeniedConfiguration" class="Machine" displayName="$(string.AccessDeniedConfiguration)" key="Software\\Policies\\Microsoft\\Windows\\srmfci">
      <parentCategory ref="SrmFci" />
    </policy>
    <policy name="NewInboxPolicy" class="Machine" displayName="New policy" key="Software\\Policies\\Microsoft">
      <parentCategory ref="SrmFci" />
    </policy>
  </policies>
</policyDefinitions>`;

const INBOX_ADML = `<policyDefinitionResources revision="1.0" schemaVersion="1.0">
  <resources>
    <stringTable>
      <string id="AccessDeniedConfiguration">Customize Access Denied errors</string>
    </stringTable>
  </resources>
</policyDefinitionResources>`;

const CATALOGUE = buildAdmxCatalogueIndex([
  {
    id: "windows/settings/access-denied-assistance",
    properties: [
      {
        address: "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration",
      },
    ],
  },
]);

describe("parseAdmxBundle", () => {
  it("pairs an ADMX with its ADML and resolves vendor URIs", () => {
    const bundle = parseAdmxBundle(
      [
        { name: "contoso.admx", text: VENDOR_ADMX },
        { name: "en-US/contoso.adml", text: VENDOR_ADML },
      ],
      { catalogue: CATALOGUE },
    );

    expect(bundle.files).toEqual([{ fileName: "contoso.admx", policyCount: 2 }]);
    expect(bundle.truncated).toBe(false);
    expect(bundle.issues).toEqual([]);
    expect(bundle.policies).toHaveLength(2);

    const device = bundle.policies[0];

    expect(device.source).toBe("vendor");
    expect(device.appName).toBe("CompanyApp");
    expect(device.fileId).toBe("contosoAdmx");
    expect(device.scope).toBe("device");
    expect(device.policy.displayName).toBe("Enable feature");
    expect(device.omaUri).toBe(
      "./Device/Vendor/MSFT/Policy/Config/CompanyApp~Policy~Root~Child/EnableFeature",
    );
    expect(device.ingestionUri).toBe(
      "./Device/Vendor/MSFT/Policy/ConfigOperations/ADMXInstall/CompanyApp/Policy/contosoAdmx",
    );
    expect(device.admxPayload).toBe(VENDOR_ADMX);
    expect(device.unmappable).toBeUndefined();

    expect(bundle.policies[1]).toMatchObject({
      scope: "user",
      omaUri: "./User/Vendor/MSFT/Policy/Config/CompanyApp~Policy~Root/UserFeature",
    });
  });

  it("maps in-box policies to the catalogue and refuses unmatched ones", () => {
    const bundle = parseAdmxBundle(
      [
        { name: "srmfci.admx", text: INBOX_ADMX },
        { name: "en-US/srmfci.adml", text: INBOX_ADML },
      ],
      { catalogue: CATALOGUE },
    );

    expect(bundle.policies).toHaveLength(2);

    const matched = bundle.policies[0];

    expect(matched).toMatchObject({
      source: "inbox",
      omaUri: "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration",
      catalogueEntry: { area: "ADMX_srmfci", scope: "device" },
    });
    expect(matched.ingestionUri).toBeUndefined();
    expect(matched.admxPayload).toBeUndefined();

    const unmatched = bundle.policies[1];

    expect(unmatched.source).toBe("inbox");
    expect(unmatched.omaUri).toBe("");
    expect(unmatched.unmappable).toMatch(/not exposed by the Windows settings catalogue/);
  });

  it("derives the app and file ids from the template name, not its zip path", () => {
    const bundle = parseAdmxBundle([{ name: "templates/admx/contoso.admx", text: VENDOR_ADMX }]);

    expect(bundle.policies[0]).toMatchObject({
      appName: "CompanyApp",
      fileId: "contosoAdmx",
      admxFileName: "templates/admx/contoso.admx",
    });
  });

  it("marks unsupported constructs as unmappable", () => {
    const admx = VENDOR_ADMX.replace(
      '<elements><text id="Server" valueName="Server" required="true" /></elements>',
      '<elements><frobnicate id="Server" /></elements>',
    );

    const bundle = parseAdmxBundle([{ name: "contoso.admx", text: admx }]);
    const policy = bundle.policies[0];

    expect(policy.unmappable).toMatch(/Unknown element <frobnicate>/);
  });

  it("caps the number of policies and reports the truncation", () => {
    const bundle = parseAdmxBundle([{ name: "contoso.admx", text: VENDOR_ADMX }], {
      maxPolicies: 1,
    });

    expect(bundle.policies).toHaveLength(1);
    expect(bundle.truncated).toBe(true);
    expect(bundle.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringMatching(/more than 1/),
        }),
      ]),
    );
  });

  it("reports a missing ADML without failing the file", () => {
    const bundle = parseAdmxBundle([{ name: "contoso.admx", text: VENDOR_ADMX }]);
    const policy = bundle.policies[0];

    expect(policy.policy.displayName).toBe("EnableFeature");
    expect(bundle.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning", message: expect.stringMatching(/No ADML/) }),
      ]),
    );
  });

  it("reports per-file parse failures and continues", () => {
    const bundle = parseAdmxBundle([
      { name: "broken.admx", text: "<policyDefinitions><policies></policyDefinitions>" },
      { name: "contoso.admx", text: VENDOR_ADMX },
    ]);

    expect(bundle.files[0]).toMatchObject({
      fileName: "broken.admx",
      policyCount: 0,
      error: expect.stringMatching(/not well formed/),
    });
    expect(bundle.policies).toHaveLength(2);
    expect(bundle.issues[0]).toMatchObject({ severity: "error", fileName: "broken.admx" });
  });

  it("requires at least one ADMX file", () => {
    const bundle = parseAdmxBundle([{ name: "en-US/contoso.adml", text: VENDOR_ADML }]);

    expect(bundle.policies).toEqual([]);
    expect(bundle.issues).toEqual([
      expect.objectContaining({ severity: "error", message: expect.stringMatching(/No \.admx/) }),
    ]);
  });
});
