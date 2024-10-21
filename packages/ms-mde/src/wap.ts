export type WapProvisioningProfile = {
	[Key: string]:
		| string
		| number
		| boolean
		| null
		| WapProvisioningProfile[]
		| WapProvisioningProfile;
};

function transformCharacteristic(name: string, incoming: unknown): unknown {
	if (incoming && Array.isArray(incoming)) {
		return incoming.map((v) => transformCharacteristic(name, v));
	} else if (incoming && typeof incoming === "object") {
		const parm: {
			"@_name": string;
			"@_value": unknown;
			"@_datatype"?: string;
		}[] = [];
		let characteristic: unknown[] = [];

		for (const [k, v] of Object.entries(incoming)) {
			if (v && typeof v === "object") {
				if (!Array.isArray(v) && "!!datatype!!" in v) {
					parm.push({
						"@_name": k,
						"@_value": v.value,
						"@_datatype": v["!!datatype!!"],
					});
					continue;
				}

				const result = transformCharacteristic(k, v);
				if (Array.isArray(result))
					characteristic = characteristic.concat(result);
				else characteristic.push(result);
				continue;
			}

			parm.push({
				"@_name": k,
				"@_value": v,
			});
		}

		return {
			"@_type": name,
			parm,
			characteristic,
		};
	}

	throw new Error(
		`Found invalid child in wap provisioning doc: '${typeof incoming}'`,
	);
}

// Wrap a value in `datatype` to ensure the `datatype` XML property is set.
export function datatype(value: unknown) {
	let datatype: string;
	if (typeof value === "boolean") {
		datatype = "boolean";
	} else if (typeof value === "number") {
		datatype = "integer";
	} else {
		throw new Error(
			`Attempted to construct datatype of unsupported type '${typeof value}'`,
		);
	}

	return {
		"!!datatype!!": datatype,
		value,
	};
}

// Convert a JSON object into the low-level structure ready for XML serialization.
export function wapProvisioningProfile(
	incoming: Record<string, WapProvisioningProfile>,
) {
	return {
		"?xml": {
			"@_version": "1.0",
			"@_encoding": "UTF-8",
		},
		"wap-provisioningdoc": {
			characteristic: Object.entries(incoming).map(([k, v]) =>
				transformCharacteristic(k, v),
			),
			"@_version": "1.1",
		},
	};
}
