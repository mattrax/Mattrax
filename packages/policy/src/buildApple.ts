import { ConfigurationSchema } from ".";
import plist from "plist";

export function buildApplePolicy(policies: ConfigurationSchema[]) {
  const data: Record<string, any> = {};

  for (const policy of policies) {
    if ("camera" in policy && policy.camera === true) {
      data["allowCamera"] = false;
    }
  }

  const plistData = {
    PayloadContent: [
      {
        PayloadDescription: "Configures settings for the camera",
        PayloadDisplayName: "Restrictions",
        PayloadIdentifier:
          "com.apple.applicationaccess.B3385932-CAD9-4E5F-A40C-483BE79F0AAE",
        PayloadType: "com.apple.applicationaccess",
        PayloadUUID: "B3385932-CAD9-4E5F-A40C-483BE79F0AAE",
        PayloadVersion: 2, // TODO: Ensure this is being updated
        ...data,
      },
    ],
    PayloadDisplayName: "Demo - camera",
    PayloadIdentifier:
      "Oscars-MacBook-Pro.D01EB329-394F-4A2C-81E6-F3975AD1224F",
    PayloadRemovalDisallowed: false,
    PayloadType: "Configuration",
    PayloadUUID: "332219C0-E04A-4661-8A17-1FDF50521250",
    PayloadVersion: 2, // TODO: Ensure this is being updated
  };

  // TODO: Sign the plist
  const result = plist.build(plistData);
  return result;
}
