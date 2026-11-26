import { expect, test } from "@playwright/test";
import { api, bootstrapSession } from "./helpers";

const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.wifi.managed</string>
      <key>PayloadIdentifier</key><string>com.example.wifi</string>
      <key>PayloadUUID</key><string>11111111-1111-1111-1111-111111111111</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadDisplayName</key><string>Corporate Wi-Fi</string>
      <key>SSID_STR</key><string>Example</string>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>Example Profile</string>
  <key>PayloadIdentifier</key><string>com.example.profile</string>
  <key>PayloadUUID</key><string>22222222-2222-2222-2222-222222222222</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadType</key><string>Configuration</string>
</dict>
</plist>`;

test.describe("mobileconfig preview", () => {
  test("parses a plist and reports friendly payload categories", async ({ page }) => {
    await bootstrapSession(page, "Preview Tenant");
    const encoded = Buffer.from(mobileconfig).toString("base64");

    const preview = await api<{
      payloads?: Array<{ type?: string }>;
      payload_categories?: Array<{ payload_type?: string }>;
    }>(page, "/api/v1/policy/preview-mobileconfig", {
      method: "POST",
      body: JSON.stringify({ mobileconfig: encoded }),
    });

    const types = [
      ...(preview.payloads ?? []).map((item) => item.type),
      ...(preview.payload_categories ?? []).map((item) => item.payload_type),
    ];

    expect(types).toContain("com.apple.wifi.managed");
  });
});
