import { describe, expect, it } from "vitest";
import {
  admxAppName,
  admxDataValue,
  admxFileId,
  admxInboxPolicyOmaUri,
  admxInstallOmaUri,
  admxVendorPolicyOmaUri,
  translateAdmxPolicy,
} from "./index.js";
import type { AdmxPolicySpec } from "./index.js";

const spec: AdmxPolicySpec = {
  elements: [
    { id: "Choice", kind: "boolean" },
    { id: "Mode", kind: "enum" },
    { id: "ModeText", kind: "enum" },
    { id: "Threshold", kind: "decimal" },
    { id: "Big", kind: "longDecimal" },
    { id: "Server", kind: "text" },
    { id: "Hosts", kind: "list" },
    { id: "Notes", kind: "multiText" },
  ],
};

describe("translateAdmxPolicy", () => {
  it("emits <disabled/> and drops element values", () => {
    const result = translateAdmxPolicy(spec, {
      enabled: false,
      values: { Mode: 2, Server: "ignored" },
    });

    expect(result.payload).toBe("<disabled/>");
    expect(result.issues).toEqual([]);
  });

  it("emits <enabled/> with numeric enum and decimal data", () => {
    const result = translateAdmxPolicy(spec, {
      enabled: true,
      values: { Mode: 2, Threshold: 25, Big: "9007199254740993" },
    });

    expect(result.payload).toBe(
      '<enabled/><data id="Mode" value="2"/><data id="Threshold" value="25"/><data id="Big" value="9007199254740993"/>',
    );
    expect(result.issues).toEqual([]);
  });

  it("keeps a text-backed enum value as text", () => {
    const result = translateAdmxPolicy(spec, {
      enabled: true,
      values: { ModeText: "Enabled" },
    });

    expect(result.payload).toBe('<enabled/><data id="ModeText" value="Enabled"/>');
  });

  it("maps boolean and list elements to their CSP representation", () => {
    const result = translateAdmxPolicy(spec, {
      enabled: true,
      values: { Choice: true, Hosts: ["a.example", "b.example"], Notes: "line one\nline two" },
    });

    expect(result.payload).toBe(
      '<enabled/><data id="Choice" value="true"/><data id="Hosts" value="a.example&#xF000;b.example"/><data id="Notes" value="line one&#xF000;line two"/>',
    );
  });

  it("escapes XML metacharacters in ids and values", () => {
    const result = translateAdmxPolicy(
      { elements: [{ id: "A&B", kind: "text" }] },
      { enabled: true, values: { "A&B": 'a < b & "c"' } },
    );

    expect(result.payload).toBe(
      '<enabled/><data id="A&amp;B" value="a &lt; b &amp; &quot;c&quot;"/>',
    );
  });

  it("reports invalid decimal values instead of writing them", () => {
    const result = translateAdmxPolicy(spec, {
      enabled: true,
      values: { Threshold: "ten" },
    });

    expect(result.payload).toBe("<enabled/>");
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: "error", elementId: "Threshold" }),
    ]);
  });

  it("skips unset values and warns about required elements", () => {
    const result = translateAdmxPolicy(
      {
        elements: [
          { id: "Required", kind: "text", required: true },
          { id: "Optional", kind: "text" },
        ],
      },
      { enabled: true, values: {} },
    );

    expect(result.payload).toBe("<enabled/>");
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: "warning", elementId: "Required" }),
    ]);
  });
});

describe("admxDataValue", () => {
  it("normalises boolean spellings", () => {
    expect(admxDataValue("boolean", true)).toBe("true");
    expect(admxDataValue("boolean", false)).toBe("false");
    expect(admxDataValue("boolean", "true")).toBe("true");
    expect(admxDataValue("boolean", "off")).toBeUndefined();
  });

  it("joins list values with the CSP separator", () => {
    expect(admxDataValue("list", ["one", "two"])).toBe("one\u{F000}two");
    expect(admxDataValue("multiText", "one\ntwo")).toBe("one\u{F000}two");
  });
});

describe("Policy CSP URIs", () => {
  it("builds the vendor Config URI from the category chain", () => {
    expect(
      admxVendorPolicyOmaUri({
        appName: "ContosoCompanyApp",
        categoryPath: ["ParentCategoryArea", "Category2", "Category3"],
        policyName: "L_PolicyPreventRun_1",
        scope: "user",
      }),
    ).toBe(
      "./User/Vendor/MSFT/Policy/Config/ContosoCompanyApp~Policy~ParentCategoryArea~Category2~Category3/L_PolicyPreventRun_1",
    );
  });

  it("uses the Device root for machine policies", () => {
    expect(
      admxVendorPolicyOmaUri({
        appName: "Chrome",
        categoryPath: ["GoogleChrome"],
        policyName: "ShowHomeButton",
        scope: "device",
      }),
    ).toBe("./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~GoogleChrome/ShowHomeButton");
  });

  it("builds the ingestion URI under ADMXInstall", () => {
    expect(admxInstallOmaUri("Chrome", "chromeAdmx")).toBe(
      "./Device/Vendor/MSFT/Policy/ConfigOperations/ADMXInstall/Chrome/Policy/chromeAdmx",
    );
  });

  it("builds an in-box URI", () => {
    expect(
      admxInboxPolicyOmaUri({
        area: "ADMX_srmfci",
        policyName: "AccessDeniedConfiguration",
        scope: "device",
      }),
    ).toBe("./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration");
  });

  it("derives app and file ids deterministically", () => {
    expect(
      admxAppName({
        namespace: "Contoso.Policies.CompanyApp",
        fileName: "contoso.admx",
      }),
    ).toBe("CompanyApp");
    expect(admxAppName({ fileName: "Chrome.admx" })).toBe("Chrome");
    expect(admxFileId("chrome.admx")).toBe("chromeAdmx");
    expect(admxFileId("Chrome.admx")).toBe("ChromeAdmx");
  });

  it("sanitises path segments the CSP cannot carry", () => {
    expect(
      admxVendorPolicyOmaUri({
        appName: "My App/1.2",
        categoryPath: ["A B"],
        policyName: "P~1",
        scope: "device",
      }),
    ).toBe("./Device/Vendor/MSFT/Policy/Config/My_App_1.2~Policy~A_B/P_1");
  });
});
