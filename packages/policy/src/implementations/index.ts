import {
	InArray,
	InferPolicyData,
	InferPolicySupportedPlatforms,
	Platform,
	PolicyDefinition,
} from "@mattrax/policies";
import plist, { PlistValue } from "plist";

export const implementPolicy = <const P extends PolicyDefinition>(
	policy: P,
	implementation: PolicyImplementation<P>,
) => {
	return {
		renderAppleProfile: (data: InferPolicyData<P>) => {
			if (!("buildAppleProfile" in implementation))
				throw new Error("This is not an Apple profile policy");

			// TODO: Sign the plist
			return plist.build({
				PayloadContent: [implementation.buildAppleProfile(data)],
				// TODO: All generated properly from DB
				PayloadDisplayName: "Untitled",
				PayloadIdentifier:
					"Oscars-MacBook-Pro.54A9B63C-F7E6-47F5-83C9-E3A10C4EE5C8",
				PayloadType: "Configuration",
				PayloadUUID: "54A9B63C-F7E6-47F5-83C9-E3A10C4EE5C8",
				PayloadVersion: 1,
			});
		},
	};
};

type DoImpl<
	P extends PolicyDefinition,
	U extends Platform,
	R extends Record<string, any>,
> = InArray<InferPolicySupportedPlatforms<P>, U> extends true ? R : {};

type PolicyImplementation<P extends PolicyDefinition> = DoImpl<
	P,
	"macOS" | "IOS" | "iPadOS" | "tvOS" | "visionOS",
	{
		buildAppleProfile: (data: InferPolicyData<P>) => PlistValue;
	}
> &
	DoImpl<
		P,
		"macOS",
		{
			buildWindowsSyncML: (data: InferPolicyData<P>) => void; // TODO: Return type
		}
	> &
	DoImpl<
		P,
		"Android",
		{
			// TODO
		}
	> &
	DoImpl<
		P,
		"Linux",
		{
			// TODO
		}
	>;
