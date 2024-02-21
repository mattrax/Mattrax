import { slack } from "@mattrax/policies";
import { implementPolicy } from ".";
import { PlistValue } from "plist";

export const slackImplementation = implementPolicy(slack, {
  buildAppleProfile: (data: any) => {
    let policy: PlistValue = {
      // TODO: Build this into `implementPolicy` so each policy doesn't care about it
      PayloadDisplayName: "Slack",
      PayloadIdentifier:
        "com.tinyspeck.slackmacgap.D3079A1B-F744-432F-9D0D-A7D9D264D25A",
      PayloadType: "com.tinyspeck.slackmacgap",
      PayloadUUID: "D3079A1B-F744-432F-9D0D-A7D9D264D25A",
      PayloadVersion: 1,
    };

    // @ts-expect-error
    if ("AutoUpdate" in data) policy["AutoUpdate"] = data.AutoUpdate;
    if ("DefaultSignInTeam" in data)
      // @ts-expect-error
      policy["DefaultSignInTeam"] = data.DefaultSignInTeam;

    return policy;
  },
  buildWindowsSyncML: () => {
    throw new Error("Not implemented");
  },
});
