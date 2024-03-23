import { parseString } from "xml2js";
import fs from "node:fs";
import path from "node:path";

// TODO: Properly account for wildcard's in the URI -> Idk how Serde will support that

function handleNode(node: any, path_prefix: string, results: any[]) {
	const name = node.NodeName[0];
	let path = path_prefix;
	if (node.Path?.[0]) path += `${node.Path[0]}`;
	path += `/${name}`;

	if ("Node" in node) {
		for (const child of node.Node) {
			handleNode(child, path, results);
		}
		return;
	}

	let access_types: ("Get" | "Add" | "Replace" | "Exec" | "Delete")[] =
		Object.keys(node.DFProperties[0].AccessType[0]);

	// We filter out properties that can only be read.
	if (access_types.length === 1 && access_types[0] === "Get") return;
	access_types = access_types.filter((a) => a !== "Get");

	// We filter out properties that can only be executed. // TODO: we probs wanna automatically know when to apply these
	if (access_types.length === 1 && access_types[0] === "Exec") {
		// console.log("Skipping Exec property", path);
		return;
	}

	// const occurrence: "One" | "ZeroOrOne" = Object.keys(
	// 	node.DFProperties[0].Occurrence[0],
	// )[0];
	// const scope: "Dynamic" = Object.keys(node.DFProperties[0].Scope[0])[0];
	// const type: "text/plain" = Object.values(node.DFProperties[0].DFType[0])[0][0];

	const datatype = Object.keys(node.DFProperties[0].DFFormat[0])[0];

	// results.push({
	// 	name,
	// 	type: "windows",
	// 	uri: path,
	// 	description: node.DFProperties[0].Description?.[0] ?? null,
	// 	datatype, // TODO: Unify this with macOS
	// 	default: node.DFProperties[0].DefaultValue?.[0] ?? null,
	// 	scope: path.startsWith("./Device") ? "device" : "user",

	// 	// TODO: Possible values -> Can enums be properly represented???

	// 	// TODO: Does this policy require user or device scope???
	// 	// TODO: Valid operations on it
	// });

	let type = "()";
	if (datatype === "bool") {
		type = "bool";
	} else if (datatype === "int") {
		type = "u64";
	} else if (datatype === "chr") {
		type = "String";
	} else if (datatype === "b64") {
		type = "String"; // TODO
	} else if (datatype === "bin") {
		type = "Vec<u8>"; // TODO
	} else {
		throw new Error(`Found unsupported datatype: ${datatype}`);
	}

	// TODO: Default
	// node.DFProperties[0].DefaultValue?.[0] ?? null

	// TODO: Scope - path.startsWith("./Device") ? "device" : "user",

	console.log(datatype);

	const comment = node.DFProperties[0].Description?.[0]
		? `/// ${node.DFProperties[0].Description?.[0].replace(
				"\n",
				"\n\t///",
		  )}\n\t`
		: "";
	results.push(`\t${comment}#[serde(rename = "${path}")]\n\t${name}(${type})`);
}

async function parseDDF(name: string, raw: string) {
	const result: any = await new Promise((resolve, reject) => {
		parseString(raw, (err, result) => {
			if (err) {
				reject(err);
			} else {
				resolve(result);
			}
		});
	});

	const parts = [];
	for (const node of result.MgmtTree.Node) {
		handleNode(node, "", parts);
	}

	return parts;
}

// TODO: Automatically find all files
const parts = [
	...(await parseDDF(
		"Policy",
		fs.readFileSync(path.join(__dirname, "../ddf/Policy.xml"), "utf8"),
	)),
	// ...(await parseDDF(
	// 	"ActiveSync",
	// 	fs.readFileSync(
	// 		path.join(__dirname, "../ddf/ActiveSyncCSP_DDF.xml"),
	// 		"utf8",
	// 	),
	// )),
	// ...(await parseDDF(
	// 	"AssignedAccess",
	// 	fs.readFileSync(
	// 		path.join(__dirname, "../ddf/AssignedAccessDDF.xml"),
	// 		"utf8",
	// 	),
	// )),
	// ...(await parseDDF(
	// 	"CertificateStore",
	// 	fs.readFileSync(
	// 		path.join(__dirname, "../ddf/CertificateStore_DDF.xml"),
	// 		"utf8",
	// 	),
	// )),
	// ...(await parseDDF(
	// 	"ClientCertificateInstall",
	// 	fs.readFileSync(
	// 		path.join(__dirname, "../ddf/ClientCertificateInstall_DDF.xml"),
	// 		"utf8",
	// 	),
	// )),
	// ...(await parseDDF(
	// 	"CMPolicyEnterprise",
	// 	fs.readFileSync(
	// 		path.join(__dirname, "../ddf/CMPolicyEnterprise_DDF.xml"),
	// 		"utf8",
	// 	),
	// )),
	// ...(await parseDDF(
	// 	"Defender",
	// 	fs.readFileSync(path.join(__dirname, "../ddf/DefenderDDF.xml"), "utf8"),
	// )),
	// 		// TODO: ...
	// 		await parseDDF(
	// 			"Win32AppInventory",
	// 			"TODO",
	// 			fs.readFileSync(
	// 				path.join(__dirname, "../ddf/Win32AppInventoryDDF.xml"),
	// 				"utf8",
	// 			),
	// 		),
	// 		// await parseDDF(
	// 		// 	"WindowsLicensingDDF",
	// 		// 	"TODO",
	// 		// 	fs.readFileSync(
	// 		// 		path.join(__dirname, "../ddf/WindowsLicensingDDF.XML"),
	// 		// 		"utf8",
	// 		// 	),
	// 		// ),
	// 		// await parseDDF(
	// 		// 	"WindowsSecurityAuditing",
	// 		// 	"TODO",
	// 		// 	fs.readFileSync(
	// 		// 		path.join(__dirname, "../ddf/WindowsSecurityAuditing_DDF.xml"),
	// 		// 		"utf8",
	// 		// 	),
	// 		// ),
];

const result = `#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "oma_uri")]
pub enum WindowsConfiguration {
${parts.join("\n")}
// TODO: Have fallback variant
}`;

console.log("Done!");
const outputPath = path.resolve(__dirname, "./windows.rs");
fs.writeFileSync(outputPath, result);

// const schema = {
// 	generated_at: new Date().toISOString().substring(0, 10),
// 	// Intentionally skipped: DevDetail_DDF.xml, DeviceManageabilityDDF.xml, DeviceStatusDDF.xml
// 	sections: [
// 		await parseDDF(
// 			"Policy",
// 			"Policy settings for Windows devices.",
// 			fs.readFileSync(path.join(__dirname, "../ddf/PolicyDDF_all.xml"), "utf8"),
// 		),
// 		await parseDDF(
// 			"ActiveSync",
// 			"TODO",
// 			fs.readFileSync(
// 				path.join(__dirname, "../ddf/ActiveSyncCSP_DDF.xml"),
// 				"utf8",
// 			),
// 		),
// 		await parseDDF(
// 			"CertificateStore",
// 			"TODO",
// 			fs.readFileSync(
// 				path.join(__dirname, "../ddf/CertificateStore_DDF.xml"),
// 				"utf8",
// 			),
// 		),
// 		await parseDDF(
// 			"ClientCertificateInstall",
// 			"TODO",
// 			fs.readFileSync(
// 				path.join(__dirname, "../ddf/ClientCertificateInstall_DDF.xml"),
// 				"utf8",
// 			),
// 		),
// 		// TODO: CMPolicyEnterprise_DDF
// 		await parseDDF(
// 			"Defender",
// 			"TODO",
// 			fs.readFileSync(path.join(__dirname, "../ddf/DefenderDDF.xml"), "utf8"),
// 		),
// 		// TODO: ...
// 		await parseDDF(
// 			"Win32AppInventory",
// 			"TODO",
// 			fs.readFileSync(
// 				path.join(__dirname, "../ddf/Win32AppInventoryDDF.xml"),
// 				"utf8",
// 			),
// 		),
// 		// await parseDDF(
// 		// 	"WindowsLicensingDDF",
// 		// 	"TODO",
// 		// 	fs.readFileSync(
// 		// 		path.join(__dirname, "../ddf/WindowsLicensingDDF.XML"),
// 		// 		"utf8",
// 		// 	),
// 		// ),
// 		// await parseDDF(
// 		// 	"WindowsSecurityAuditing",
// 		// 	"TODO",
// 		// 	fs.readFileSync(
// 		// 		path.join(__dirname, "../ddf/WindowsSecurityAuditing_DDF.xml"),
// 		// 		"utf8",
// 		// 	),
// 		// ),
// 	],
// };

// const schemaPath = path.resolve(__dirname, "../src/windows.rs");
// const numConfigurations = schema.sections
// 	.map((s) => s.properties.length)
// 	.reduce((a, b) => a + b, 0);
// console.log(
// 	`Saved schema with ${numConfigurations} configurations to '${schemaPath}'`,
// );
// fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
