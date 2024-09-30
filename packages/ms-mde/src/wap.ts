export type WapProvisioningProfile = {
	[Key: string]:
		| string
		| number
		| boolean
		| null
		| WapProvisioningProfile[]
		| WapProvisioningProfile;
};

function mapCharacteristics(characteristic: WapProvisioningProfile): unknown[] {
	return Object.entries(characteristic).map(([key, value]) => {
		if (value && Array.isArray(value)) {
			return value.map(mapCharacteristics);
		} else if (value && typeof value === "object") {
			return {
				"@_type": key,
				characteristic: mapCharacteristics(value),
			};
		}

		return {
			parm: {
				"@_name": key,
				"@_value": value,
			},
		};
	});
}

export const wapProvisioningProfile = (
	characteristic: WapProvisioningProfile,
) => ({
	"?xml": {
		"@_version": "1.0",
		"@_encoding": "UTF-8",
	},
	"wap-provisioningdoc": {
		"@_version": "1.1",
		characteristic: mapCharacteristics(characteristic),
	},
});
