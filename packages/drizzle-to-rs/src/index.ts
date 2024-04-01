import fs from "node:fs";
import { execSync } from "node:child_process";
import type { TypedQueryBuilder } from "drizzle-orm/query-builders/query-builder";
import type { SQLWrapper } from "drizzle-orm";
import type { Query as DrizzleQuery } from "drizzle-orm";

// TODO: Allow array of arguments (insert many)

const camelToSnakeCase = (str: string) =>
	str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const snakeToCamel = (str: string) => {
	const a = str
		.toLowerCase()
		.replace(/([-_][a-z])/g, (group) =>
			group.toUpperCase().replace("-", "").replace("_", ""),
		);
	return a[0]?.toUpperCase() + a.slice(1);
};

type RustType =
	| "String"
	| "NaiveDateTime"
	| "Now"
	| "Vec<u8>"
	| "u64"
	| "Serialized<serde_json::Value>"; // TODO: Rest of types
type RustArgs = Record<string, RustType>;

type MapArgsToTs<T> = {
	[K in keyof T]: T[K] extends "String"
		? string
		: T[K] extends "i32"
		  ? number
		  : never;
};

type QueryDefinition<T> = {
	name: string;
	args?: T;
	query: (args: MapArgsToTs<T>) =>
		| TypedQueryBuilder<any, any>
		| {
				toSQL(): DrizzleQuery;
		  }
		| SQLWrapper;
};

type Query = {
	renderedResultType: string;
	renderedFn: string;
};

class Placeholder {
	name: string;
	"#placeholder" = "placeholder";

	constructor(name: string) {
		this.name = name;
	}

	// Drizzle converts dates to strings so we need a way to know when to convert them to a Rust param.
	toISOString() {
		return `####rs#${this.name}_`; // Drizzle strips the last char
	}
}

export function defineOperation<const T extends RustArgs = never>(
	query: QueryDefinition<T>,
): Query {
	// TODO: Bun is broken if this is a global
	const sqlDatatypeToRust = {
		string: "String",
		number: "u64",
		date: "NaiveDateTime",
		boolean: "bool",
		json: "Deserialized<serde_json::Value>",
	};

	const op = query.query(
		new Proxy(
			{},
			{
				get: (_, prop) => new Placeholder(prop as string),
			},
		) as any,
	);
	// @ts-expect-error
	const sql: { sql: string; params: string[] } = op.toSQL();
	const isQuery = "_" in op;

	const resultTyName = `${snakeToCamel(query.name)}Result`;

	let fn_args = "";
	let defined = "";
	if (query.args && Object.keys(query.args).length > 0) {
		fn_args =
			", " +
			Object.entries(query.args || {})
				.filter(([k, v]) => v !== "Now")
				.map(([k, v]) => `${camelToSnakeCase(k)}: ${v}`)
				.join(",");
		defined = Object.entries(query.args || {})
			.filter(([k, v]) => v === "Now")
			.map(
				([k, v]) =>
					`let ${camelToSnakeCase(k)} = chrono::Utc::now().naive_utc();`,
			)
			.join("\n");
	}

	return {
		renderedResultType: !isQuery
			? ""
			: `#[derive(Debug)]\npub struct ${resultTyName} {
    ${Object.entries(op._.selectedFields)
			.map(([k, v]) => {
				const v2 = v as any;
				if (!(v2.dataType in sqlDatatypeToRust)) {
					throw new Error(`Unknown datatype: ${v2.dataType}`);
				}

				let ty =
					v2.columnType === "MySqlVarBinary"
						? "Vec<u8>"
						: (sqlDatatypeToRust as any)[v2.dataType];
				if (!v2.notNull) {
					ty = `Option<${ty}>`;
				}

				return `pub ${camelToSnakeCase(k)}: ${ty}`;
			})
			.join(",")}
}`,
		renderedFn:
			`impl Db {
        pub async fn ${query.name}(&self${fn_args}) -> Result<` +
			(!isQuery ? "()" : `Vec<${resultTyName}>`) +
			`, mysql_async::Error> {
		  ${defined}
          r#"${sql.sql}"#
            .with(mysql_async::Params::Positional(vec![${sql.params
							// TODO: If the user puts a static value, this will snake case it.
							// We should detect a special suffix which the `Proxy` will return.
							.map((p) => {
								// @ts-expect-error
								if (p instanceof Placeholder) {
									return `${camelToSnakeCase(p.name)}.clone().into()`;
								} else if (typeof p === "string" && p.startsWith("####rs#")) {
									return `${camelToSnakeCase(
										p.replaceAll("####rs#", ""),
									)}.clone().into()`;
								}

								const columnName = isJsonPlaceholder(p);
								if (columnName) {
									return `${camelToSnakeCase(columnName)}.clone().into()`;
								}

								return `${typeof p === "number" ? p : `"${p}"`}.into()`;
							}) // TODO: Only call `.clone()` when the value is used multiple times
							.join(",")}]))
            ` +
			(!isQuery
				? ".run(&self.pool)"
				: `.map(&self.pool, |p: (${Object.entries(op._.selectedFields)
						.map(([k, v]) => {
							const v2 = v as any;
							if (!(v2.dataType in sqlDatatypeToRust)) {
								throw new Error(`Unknown datatype: ${v2.dataType}`);
							}

							let ty =
								v2.columnType === "MySqlVarBinary"
									? "Vec<u8>"
									: (sqlDatatypeToRust as any)[v2.dataType];
							if (!v2.notNull) {
								ty = `Option<${ty}>`;
							}

							return `${ty}`;
						})
						.join(",")},)| ${resultTyName} {
                ${Object.entries(op._.selectedFields)
									.map(([k, v], i) => {
										return `${camelToSnakeCase(k)}: p.${i}`;
									})
									.join(",")}
              })`) +
			`
            .await
            ` +
			(!isQuery ? ".map(|_| ())" : "") +
			`
        }
    }`,
	};
}

export function exportQueries(queries: Query[], path: string) {
	console.log(`Exporting ${queries.length} queries...`);

	const dbStruct = `#[derive(Clone)]
  pub struct Db {
    pool: mysql_async::Pool,
  }`;
	const dbStructConstructor = `impl Db {
    pub fn new(db_url: &str) -> Self {
        Self {
          pool: mysql_async::Pool::new(db_url),
        }
    }
  }`;

	fs.writeFileSync(
		path,
		[
			"// This file was generated by '@mattrax/drizzle-to-rs'",
			"#![allow(unused)]\n",
			"use mysql_async::{Serialized, Deserialized, prelude::*};",
			"use chrono::NaiveDateTime;\n",
			queries.map((q) => q.renderedResultType).join("\n"),
			dbStruct,
			dbStructConstructor,
			queries.map((q) => q.renderedFn).join("\n"),
		].join("\n"),
	);

	execSync(`rustfmt --edition 2021 ${path}`);

	console.log(`Exported Rust Drizzle bindings to '${path}'`);
}

function isJsonPlaceholder(s: any) {
	if (typeof s === "string") {
		try {
			const placeholder = JSON.parse(s);

			if (
				placeholder["#placeholder"] === "placeholder" &&
				"name" in placeholder
			) {
				return placeholder.name;
			}
		} catch (e) {}
	}
}
