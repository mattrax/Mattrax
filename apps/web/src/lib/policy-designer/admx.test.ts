import { describe, expect, it } from "vitest";
import { buildAdmxCatalogueIndex, parseAdmxBundle } from "@mattrax/enterprise-domain/admx";
import type { AdmxDiscoveredPolicy } from "@mattrax/enterprise-domain/admx";
import {
  admxCollectionFromSelection,
  admxPolicyCollection,
  admxPolicySelection,
  isAdmxCollectionId,
} from "./admx";
import { ADMX_STATE_KEY, buildWindowsNodes, defaultValues, validateDraft } from "./build";
import type { Draft, PolicyValueMap, Selection } from "./build";
import { collectionProperties } from "./catalog";

const VENDOR_ADMX = `<policyDefinitions revision="1.0" schemaVersion="1.0">
  <policyNamespaces><target prefix="contoso" namespace="Contoso.Policies.CompanyApp" /></policyNamespaces>
  <categories>
    <category name="Root" displayName="$(string.Root)" />
    <category name="Child"><parentCategory ref="Root" /></category>
  </categories>
  <policies>
    <policy name="EnableFeature" class="Machine" displayName="$(string.EnableFeature)" explainText="$(string.Explain)" presentation="$(presentation.EnableFeature)" key="Software\\Policies\\Contoso" valueName="EnableFeature">
      <parentCategory ref="Child" />
      <enabledValue><decimal value="1" /></enabledValue>
      <disabledValue><decimal value="0" /></disabledValue>
      <elements>
        <boolean id="Choice" valueName="Choice" />
        <enum id="Mode" valueName="Mode" required="true">
          <item displayName="$(string.Off)"><value><decimal value="0" /></value></item>
          <item displayName="$(string.On)"><value><decimal value="1" /></value></item>
        </enum>
        <decimal id="Threshold" valueName="Threshold" minValue="0" maxValue="100" />
        <list id="Hosts" valueName="Hosts">
          <item displayName="A"><value><string value="a.example" /></value></item>
          <item displayName="B"><value><string value="b.example" /></value></item>
        </list>
        <text id="Server" valueName="Server" required="true" />
      </elements>
    </policy>
  </policies>
</policyDefinitions>`;

const VENDOR_ADML = `<policyDefinitionResources revision="1.0" schemaVersion="1.0">
  <resources>
    <stringTable>
      <string id="Root">Contoso</string>
      <string id="EnableFeature">Enable the feature</string>
      <string id="Explain">Turns the feature on.</string>
      <string id="Off">Off</string>
      <string id="On">On</string>
    </stringTable>
    <presentationTable>
      <presentation id="EnableFeature">
        <checkBox refId="Choice">Enable choice</checkBox>
        <dropdownList refId="Mode" defaultItem="1" label="Mode" />
        <decimalTextBox refId="Threshold" defaultValue="10">Threshold</decimalTextBox>
        <listBox refId="Hosts">Hosts</listBox>
        <textBox refId="Server" label="Server name" />
      </presentation>
    </presentationTable>
  </resources>
</policyDefinitionResources>`;

const INBOX_ADMX = `<policyDefinitions revision="1.0" schemaVersion="1.0">
  <policyNamespaces><target prefix="srmfci" namespace="Microsoft.Policies.SrmFci" /></policyNamespaces>
  <categories><category name="SrmFci" /></categories>
  <policies>
    <policy name="AccessDeniedConfiguration" class="Machine" displayName="Access Denied" key="Software\\Policies\\Microsoft\\Windows\\srmfci">
      <parentCategory ref="SrmFci" />
      <enabledValue><decimal value="1" /></enabledValue>
      <elements><enum id="Mode" valueName="Mode"><item displayName="Disabled"><value><decimal value="0" /></value></item><item displayName="Enabled"><value><decimal value="1" /></value></item></enum></elements>
    </policy>
  </policies>
</policyDefinitions>`;

const catalogue = buildAdmxCatalogueIndex([
  {
    id: "windows/settings/access-denied-assistance",
    properties: [
      {
        address: "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration",
      },
    ],
  },
]);

const discover = (): AdmxDiscoveredPolicy => {
  const bundle = parseAdmxBundle(
    [
      { name: "contoso.admx", text: VENDOR_ADMX },
      { name: "en-US/contoso.adml", text: VENDOR_ADML },
    ],
    { catalogue },
  );

  return bundle.policies[0];
};

const discoverInbox = (): AdmxDiscoveredPolicy => {
  const bundle = parseAdmxBundle([{ name: "srmfci.admx", text: INBOX_ADMX }], { catalogue });

  return bundle.policies[0];
};

const selectionFor = (policy: AdmxDiscoveredPolicy, values: PolicyValueMap) => {
  const selection = admxPolicySelection(policy)!;
  const properties = collectionProperties(selection.collection);

  return {
    selection: {
      collectionId: `${selection.collection.id}#${selection.collection.name}`,
      identifier: selection.collection.identifier,
      kind: selection.collection.kind,
      surface: selection.collection.surface,
      name: selection.collection.name,
      properties,
      values: { ...defaultValues(selection.collection), ...values },
      template: selection.template,
    } satisfies Selection,
    collection: selection.collection,
    template: selection.template,
  };
};

const draft = (selection: Selection): Draft => ({
  version: 1,
  platform: "windows",
  name: "Imported ADMX",
  selections: [selection],
});

describe("admxPolicyCollection", () => {
  it("maps an ADMX policy onto designer properties", () => {
    const collection = admxPolicyCollection(discover())!;

    expect(collection.id).toBe("admx:vendor:CompanyApp:EnableFeature");
    expect(isAdmxCollectionId(collection.id)).toBe(true);
    expect(collection.name).toBe("Enable the feature");
    expect(collection.group).toBe("Imported ADMX · CompanyApp");
    expect(collection.identifier).toBe(
      "./Device/Vendor/MSFT/Policy/Config/CompanyApp~Policy~Root~Child/EnableFeature",
    );

    const state = collection.properties[0];

    expect(state).toMatchObject({
      key: "admxState",
      valueKey: ADMX_STATE_KEY,
      defaultValue: "enabled",
      type: "enum",
    });

    const choice = collection.properties.find((property) => property.key === "Choice")!;

    expect(choice).toMatchObject({
      valueKey: "Choice",
      type: "boolean",
      name: "Enable choice",
      address: collection.identifier,
      scope: "device",
    });

    const mode = collection.properties.find((property) => property.key === "Mode")!;

    expect(mode).toMatchObject({ type: "enum", required: true, defaultValue: "1" });
    expect(mode.enum).toEqual([
      { value: "0", description: "Off" },
      { value: "1", description: "On" },
    ]);

    const threshold = collection.properties.find((property) => property.key === "Threshold")!;

    expect(threshold).toMatchObject({ type: "integer", min: 0, max: 100, defaultValue: 10 });

    expect(collection.properties.find((property) => property.key === "Hosts")).toMatchObject({
      type: "array",
    });
  });

  it("refuses a policy the importer marked as unmappable", () => {
    const bundle = parseAdmxBundle(
      [{ name: "srmfci.admx", text: INBOX_ADMX.replace("AccessDeniedConfiguration", "Unknown") }],
      { catalogue },
    );

    expect(admxPolicyCollection(bundle.policies[0])).toBeNull();
  });
});

describe("ADMX selections", () => {
  it("builds the ADMXInstall node before the policy payload", () => {
    const { selection } = selectionFor(discover(), {
      Choice: true,
      Mode: 1,
      Threshold: 42,
      Hosts: ["a.example", "b.example"],
    });

    const nodes = buildWindowsNodes(draft(selection));

    expect(nodes.map((node) => node.omaUri)).toEqual([
      "./Device/Vendor/MSFT/Policy/ConfigOperations/ADMXInstall/CompanyApp/Policy/contosoAdmx",
      "./Device/Vendor/MSFT/Policy/Config/CompanyApp~Policy~Root~Child/EnableFeature",
    ]);
    expect(nodes[0]?.value).toBe(VENDOR_ADMX);
    expect(nodes[0]?.format).toBe("chr");
    expect(nodes[1]?.format).toBe("chr");
    expect(nodes[1]?.value).toBe(
      '<enabled/><data id="Choice" value="true"/><data id="Mode" value="1"/><data id="Threshold" value="42"/><data id="Hosts" value="a.example&#xF000;b.example"/>',
    );
  });

  it("writes only <disabled/> for a disabled policy", () => {
    const { selection } = selectionFor(discover(), {
      [ADMX_STATE_KEY]: "disabled",
      Choice: true,
      Mode: 1,
    });

    const nodes = buildWindowsNodes(draft(selection));

    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.value).toBe("<disabled/>");
  });

  it("maps an in-box policy to the catalogue URI without ingestion", () => {
    const { selection } = selectionFor(discoverInbox(), { Mode: 1 });
    const nodes = buildWindowsNodes(draft(selection));

    expect(nodes.map((node) => node.omaUri)).toEqual([
      "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration",
    ]);
    expect(nodes[0]?.value).toBe('<enabled/><data id="Mode" value="1"/>');
  });

  it("validates a required element through the translator", () => {
    const { selection } = selectionFor(discover(), { Mode: 1 });
    const issues = validateDraft(draft(selection));

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          propertyKey: "Server",
          message: expect.stringMatching(/required by the template/),
        }),
      ]),
    );
  });

  it("rebuilds the collection from a saved selection", () => {
    const { collection, selection } = selectionFor(discover(), {});
    const rebuilt = admxCollectionFromSelection(selection)!;

    expect(rebuilt.id).toBe(collection.id);
    expect(rebuilt.properties).toEqual(collection.properties);
    expect(rebuilt.name).toBe(collection.name);
  });
});
