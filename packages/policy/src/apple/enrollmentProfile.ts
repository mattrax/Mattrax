import plist from "plist";

export function buildAppleEnrollmentProfile(url: string, challenge: string) {
  const plistData = {
    PayloadDisplayName: "Mattrax Enrollment Profile",
    PayloadDescription:
      "Install this profile to get access to your company apps",
    PayloadIdentifier: "Mattrax.Enrollment",
    PayloadType: "Profile Service",
    PayloadVersion: 1,
    PayloadUUID: "90D2F66B-9A38-4A31-9503-B4126E6C19F1",
    PayloadContent: {
      URL: url,
      Challenge: challenge,
      DeviceAttributes: [
        "UDID",
        "IMEI",
        "ICCID",
        "SERIAL",
        "PRODUCT",
        "VERSION",
      ],
    },
  };

  // TODO: Sign the plist
  const result = plist.build(plistData);
  return result;
}
