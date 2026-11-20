import { describe, expect, it } from "vitest";
import { AdmxImportError, parseAdmxFile } from "./index.js";

const ADMX = `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitions revision="1.0" schemaVersion="1.0">
  <policyNamespaces>
    <target prefix="contoso" namespace="Contoso.Policies.CompanyApp" />
    <using prefix="windows" namespace="Microsoft.Policies.Windows" />
  </policyNamespaces>
  <resources minRequiredRevision="1.0" />
  <categories>
    <category name="Root" displayName="$(string.Root)" />
    <category name="Child" displayName="$(string.Child)">
      <parentCategory ref="Root" />
    </category>
  </categories>
  <policies>
    <policy name="EnableFeature" class="Machine" displayName="$(string.EnableFeature)" explainText="$(string.EnableFeature_Explain)" presentation="$(presentation.EnableFeature)" key="Software\\Policies\\Contoso" valueName="EnableFeature">
      <parentCategory ref="Child" />
      <supportedOn ref="windows:SUPPORTED_Windows_10_0" />
      <enabledValue><decimal value="1" /></enabledValue>
      <disabledValue><decimal value="0" /></disabledValue>
      <elements>
        <boolean id="Choice" valueName="Choice" />
        <enum id="Mode" valueName="Mode" required="true">
          <item displayName="$(string.ModeOff)"><value><decimal value="0" /></value></item>
          <item displayName="$(string.ModeOn)"><value><decimal value="1" /></value></item>
        </enum>
        <decimal id="Threshold" valueName="Threshold" minValue="0" maxValue="100" />
        <text id="Server" valueName="Server" required="true" />
        <list id="Hosts" valueName="Hosts">
          <item displayName="$(string.HostA)"><value><string value="a.example" /></value></item>
          <item displayName="$(string.HostB)"><value><string value="b.example" /></value></item>
        </list>
      </elements>
    </policy>
    <policy name="Legacy" class="User" displayName="$(string.Legacy)" key="Software\\Policies\\Contoso" valueName="Legacy">
      <parentCategory ref="Root" />
      <enabledList>
        <item valueName="One"><value><decimal value="1" /></value></item>
      </enabledList>
      <disabledList>
        <item valueName="One"><value><delete /></value></item>
      </disabledList>
    </policy>
  </policies>
</policyDefinitions>`;

const ADML = `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitionResources revision="1.0" schemaVersion="1.0">
  <displayName>Contoso</displayName>
  <description>Contoso templates</description>
  <resources>
    <stringTable>
      <string id="Root">Contoso</string>
      <string id="Child">Company app</string>
      <string id="EnableFeature">Enable the feature</string>
      <string id="EnableFeature_Explain">Turns the company app feature on.</string>
      <string id="ModeOff">Off</string>
      <string id="ModeOn">On</string>
      <string id="HostA">Primary host</string>
      <string id="HostB">Secondary host</string>
      <string id="Legacy">Legacy setting</string>
    </stringTable>
    <presentationTable>
      <presentation id="EnableFeature">
        <text>Configure the feature before enabling it.</text>
        <checkBox refId="Choice" defaultChecked="true">Enable choice</checkBox>
        <dropdownList refId="Mode" defaultItem="1" label="Mode">
          <item displayName="Off" />
          <item displayName="On" />
        </dropdownList>
        <decimalTextBox refId="Threshold" defaultValue="10">Threshold</decimalTextBox>
        <textBox refId="Server" label="Server name" />
        <listBox refId="Hosts">Hosts</listBox>
      </presentation>
    </presentationTable>
  </resources>
</policyDefinitionResources>`;

const parse = () => parseAdmxFile(ADMX, ADML, { fileName: "contoso.admx" });

describe("parseAdmxFile", () => {
  it("reads namespaces, categories, policies and registry values", () => {
    const file = parse();

    expect(file.namespace).toBe("Contoso.Policies.CompanyApp");
    expect(file.prefix).toBe("contoso");
    expect(file.fileName).toBe("contoso.admx");
    expect(file.policies).toHaveLength(2);

    const policy = file.policies[0]!;

    expect(policy.name).toBe("EnableFeature");
    expect(policy.className).toBe("machine");
    expect(policy.displayName).toBe("Enable the feature");
    expect(policy.description).toBe("Turns the company app feature on.");
    expect(policy.key).toBe("Software\\Policies\\Contoso");
    expect(policy.valueName).toBe("EnableFeature");
    expect(policy.categoryPath).toEqual(["Root", "Child"]);
    expect(policy.categoryDisplayPath).toEqual(["Contoso", "Company app"]);
    expect(policy.enabledValue).toEqual({ kind: "decimal", value: "1" });
    expect(policy.disabledValue).toEqual({ kind: "decimal", value: "0" });
    expect(policy.supportedOn).toBe("windows:SUPPORTED_Windows_10_0");
    expect(policy.unsupported).toEqual([]);
  });

  it("reads presentation elements and uses them to label the elements", () => {
    const policy = parse().policies[0]!;
    const [choice, mode, threshold, server, hosts] = policy.elements;

    expect(policy.presentations).toHaveLength(6);
    expect(policy.presentations[0]).toMatchObject({ kind: "text" });
    expect(policy.presentations[1]).toMatchObject({
      kind: "checkBox",
      refId: "Choice",
      text: "Enable choice",
      defaultChecked: true,
    });
    expect(policy.presentations[2]).toMatchObject({
      kind: "dropdownList",
      refId: "Mode",
      defaultItem: 1,
      items: ["Off", "On"],
    });

    expect(choice).toMatchObject({ id: "Choice", kind: "boolean", label: "Enable choice" });
    expect(mode).toMatchObject({
      id: "Mode",
      kind: "enum",
      label: "Mode",
      required: true,
      defaultItem: 1,
    });
    expect(mode?.items?.map((item) => item.displayName)).toEqual(["Off", "On"]);
    expect(mode?.items?.[1]?.value).toEqual({ kind: "decimal", value: "1" });
    expect(threshold).toMatchObject({
      id: "Threshold",
      kind: "decimal",
      minValue: "0",
      maxValue: "100",
      defaultValue: "10",
    });
    expect(server).toMatchObject({ id: "Server", kind: "text", label: "Server name", required: true });
    expect(hosts).toMatchObject({ id: "Hosts", kind: "list", label: "Hosts" });
    expect(hosts?.items?.[0]?.value).toEqual({ kind: "string", value: "a.example" });
  });

  it("reads enabledList/disabledList semantics", () => {
    const policy = parse().policies[1]!;

    expect(policy.className).toBe("user");
    expect(policy.enabledList).toEqual([
      { valueName: "One", value: { kind: "decimal", value: "1" } },
    ]);
    expect(policy.disabledList).toEqual([{ valueName: "One", value: { kind: "delete" } }]);
    expect(policy.categoryPath).toEqual(["Root"]);
  });

  it("falls back to string ids when no ADML is supplied", () => {
    const file = parseAdmxFile(ADMX, undefined, { fileName: "contoso.admx" });
    const policy = file.policies[0]!;

    expect(policy.displayName).toBe("EnableFeature");
    expect(policy.categoryDisplayPath).toEqual(["Root", "Child"]);
    expect(policy.elements[0]?.label).toBe("Choice");
    expect(file.unresolvedStrings).toContain("EnableFeature");
    expect(file.warnings.join(" ")).toMatch(/No matching ADML/);
  });

  it("records a missing string without rejecting the file", () => {
    const file = parseAdmxFile(ADMX, ADML.replace('id="ModeOn"', 'id="NotUsed"'));
    const policy = file.policies[0]!;

    expect(policy.elements[1]?.items?.[1]?.displayName).toBe("ModeOn");
    expect(file.unresolvedStrings).toContain("ModeOn");
  });

  it("records unsupported constructs instead of silently dropping them", () => {
    const admx = ADMX.replace(
      '<boolean id="Choice" valueName="Choice" />',
      '<boolean id="Choice" valueName="Choice"><trueList><item valueName="X"><value><decimal value="1" /></value></item></trueList></boolean><frobnicate id="Other" />',
    );

    const file = parseAdmxFile(admx, ADML);
    const policy = file.policies[0]!;

    expect(policy.unsupported.join(" ")).toMatch(/trueList/);
    expect(policy.unsupported.join(" ")).toMatch(/Unknown element <frobnicate>/);
  });

  it("rejects duplicate element ids", () => {
    const admx = ADMX.replace(
      '<text id="Server" valueName="Server" required="true" />',
      '<text id="Server" valueName="Server" required="true" /><text id="Server" valueName="Other" />',
    );

    const policy = parseAdmxFile(admx, ADML).policies[0]!;

    expect(policy.unsupported.join(" ")).toMatch(/defined more than once/);
  });

  it("cuts a cyclic category path and warns", () => {
    const admx = ADMX.replace(
      '<category name="Root" displayName="$(string.Root)" />',
      '<category name="Root" displayName="$(string.Root)"><parentCategory ref="Child" /></category>',
    );

    const file = parseAdmxFile(admx, ADML);
    const policy = file.policies[0]!;

    expect(policy.categoryPath).toEqual(["Root", "Child"]);
    expect(file.warnings.join(" ")).toMatch(/own ancestor/);
  });

  it("rejects malformed XML", () => {
    expect(() => parseAdmxFile("<policyDefinitions><policies></policyDefinitions>")).toThrow(
      AdmxImportError,
    );

    try {
      parseAdmxFile("<policyDefinitions><policies></policyDefinitions>");
    } catch (error) {
      if (!(error instanceof AdmxImportError)) throw error;

      expect(error.code).toBe("malformed-xml");
    }
  });

  it("rejects a document type declaration before parsing (XXE)", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE policyDefinitions [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<policyDefinitions><policies><policy name="x">&xxe;</policy></policies></policyDefinitions>`;

    try {
      parseAdmxFile(xxe);
      throw new Error("expected the parser to reject the DTD");
    } catch (error) {
      expect(error).toBeInstanceOf(AdmxImportError);

      if (!(error instanceof AdmxImportError)) throw error;

      expect(error.code).toBe("dtd-not-allowed");
    }
  });

  it("rejects an external DTD reference", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE policyDefinitions SYSTEM "https://example.invalid/evil.dtd">
<policyDefinitions><policies /></policyDefinitions>`;

    expect(() => parseAdmxFile(xxe)).toThrow(/not allowed/);
  });

  it("rejects a wrong root element", () => {
    expect(() => parseAdmxFile("<root />", undefined, { fileName: "bad.admx" })).toThrow(
      /Expected <policyDefinitions>/,
    );
    expect(() => parseAdmxFile(ADMX, "<root />")).toThrow(/Expected <policyDefinitionResources>/);
  });

  it("rejects an oversized document", () => {
    const deep = "<policyDefinitions>" + "<a>".repeat(80) + "</a>".repeat(80) + "</policyDefinitions>";

    expect(() => parseAdmxFile(deep)).toThrow(/nested more than/);
  });
});
