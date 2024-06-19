export type EnumContent = { description: string | null };
export type IntAllowedValues =
	| { valueType: "range"; min: number; max: number }
	| { valueType: "enum"; enum: { [key in string]: EnumContent } };
export type Scope = "user" | "device";
export type WindowsCSP = {
	name: string;
	nodes: { [key in string]: WindowsDDFNode };
};
export type WindowsDDFNode = (
	| {
			format: "int";
			defaultValue: number;
			allowedValues?: IntAllowedValues | null;
	  }
	| { format: "bool" }
	| { format: "string" }
	| { format: "node"; nodes: { [key in string]: WindowsDDFNode } }
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
	scope: Scope;
	dynamic: string | null;
};
