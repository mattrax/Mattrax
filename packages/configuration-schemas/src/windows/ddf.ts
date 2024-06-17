export type EnumContent = { description: string | null };
export type IntAllowedValues =
	| { valueType: "range"; min: number; max: number }
	| { valueType: "enum"; enum: { [key in string]: EnumContent } };
export type Scope = "user" | "device";
export type WindowsCSP = {
	name: string;
	policies: { [key in string]: WindowsDDFPolicy };
};
export type WindowsDDFPolicy = (
	| {
			format: "int";
			defaultValue: number;
			allowedValues?: IntAllowedValues | null;
	  }
	| { format: "bool" }
	| { format: "string" }
	| { format: "node" }
	| { format: "null" }
	| { format: "base64" }
	| { format: "time" }
	| { format: "float" }
	| { format: "xml" }
	| { format: "bin" }
) & {
	name: string;
	title?: string | null;
	description?: string | null;
	nodes: { [key in string]: WindowsDDFPolicy };
	scope: Scope;
};
