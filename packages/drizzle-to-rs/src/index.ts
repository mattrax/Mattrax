//! Export Drizzle queries to Rust
//! This entire thing is cobbled together using some of the worse code I've ever written.

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
	| "i64"
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
		return `####rs#${this.name}`; // Drizzle strips the last char
	}
}

/// This function hints to `drizzle-to-rs` the contents of this object is all from a left join.
/// So it will be exported as `Option` in Rust.
///
/// If you misuse this hint you'll get runtime errors from Rust.
///
/// I can't find an automatic way to detect this, so this is the best we are getting.
export function leftJoinHint<T extends object>(t: T): T {
	const proto = {
		leftJoinThis() {
			return true;
		},
	};

	const obj = Object.create(proto);
	Object.assign(obj, t);
	return obj;
}

/// Can we used with `sql`...`.mapWith(asString)` to ensure Rust knows the column is a string.
export function asString(v: any): string {
	return String(v);
}

export function defineOperation<const T extends RustArgs = never>(
	query: QueryDefinition<T>,
): Query {
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

	let fn_args = "";
	let defined = "";
	if (query.args && Object.keys(query.args).length > 0) {
		fn_args = `, ${Object.entries(query.args || {})
			.filter(([k, v]) => v !== "Now")
			.map(([k, v]) => `${camelToSnakeCase(k)}: ${v}`)
			.join(",")}`;
		defined = Object.entries(query.args || {})
			.filter(([k, v]) => v === "Now")
			.map(
				([k, v]) =>
					`let ${camelToSnakeCase(k)} = chrono::Utc::now().naive_utc();`,
			)
			.join("\n");
	}

	const rustTypes = new Map();
	let resultType = "()";
	let impl = "Ok(())";

	if (isQuery) {
		const tyName = buildResultType(rustTypes, op._.selectedFields, query.name);
		resultType = `Vec<${tyName}>`;
		impl = `Ok(resp.into_iter().map(|row| ${
			rustTypes.get(tyName).impl
		}).collect())`;
	}

	return {
		renderedResultType: [...rustTypes.values()]
			.map((t) => t.declaration)
			.join("\n"),
		renderedFn: `impl Db {
				pub async fn ${query.name}(&self${fn_args}) -> Result<${resultType}, tokio_postgres::Error> {
		      ${defined}
          let resp = self.0.client.query(r#"${sql.sql}"#, &[${sql.params
						// TODO: If the user puts a static value, this will snake case it.
						// We should detect a special suffix which the `Proxy` will return.
						.map((p) => {
							// @ts-expect-error
							if (p instanceof Placeholder) {
								return `&${camelToSnakeCase(p.name)}`;
							}
							if (typeof p === "string" && p.startsWith("####rs#")) {
								return `&${camelToSnakeCase(p.replaceAll("####rs#", ""))}`;
							}

							const columnName = isJsonPlaceholder(p);
							if (columnName) {
								return `&${camelToSnakeCase(columnName)}`;
							}

							return `${typeof p === "number" ? p : `&"${p}"`}`;
						}) // TODO: Only call `.clone()` when the value is used multiple times
						.join(",")}]).await?;\n${impl}
        }
      }`,
	};
}

export function exportQueries(queries: Query[], path: string) {
	console.log(`Exporting ${queries.length} queries...`);

	const rust = `
      // This file was generated by '@mattrax/drizzle-to-rs'
      #![allow(unused)]
      use mysql_async::{Serialized, Deserialized, prelude::*};
      use chrono::NaiveDateTime;

      ${queries.map((q) => q.renderedResultType).join("\n")}

      pub struct DbInner {
          client: tokio_postgres::Client,
      }

      #[derive(Clone)]
      pub struct Db(std::sync::Arc<DbInner>);

      impl std::ops::Deref for Db {
          type Target = DbInner;

          fn deref(&self) -> &Self::Target {
              &self.0
          }
      }

      impl Db {
          pub async fn new(db_url: &str) -> Self {
              let (client, connection) = tokio_postgres::connect(
                  db_url,
                  postgres_native_tls::MakeTlsConnector::new(
                      native_tls::TlsConnector::builder().build().unwrap(),
                  ),
              )
              .await
              .unwrap();

              tokio::spawn(async move {
                  if let Err(e) = connection.await {
                      eprintln!("connection error: {}", e);
                  }
              });

              Self(std::sync::Arc::new(DbInner { client }))
          }
      }

      ${queries.map((q) => q.renderedFn).join("\n")}
  `.trim();

	fs.writeFileSync(path, rust);

	execSync(`rustfmt --edition 2021 ${path}`);

	console.log(`Exported Rust Drizzle bindings to '${path}'`);
}

const sqlDatatypeToRust = {
	string: "String",
	number: "i64",
	date: "NaiveDateTime",
	boolean: "bool",
	json: "serde_json::Value",
	custom: "Vec<u8>",
};

type RustTypeDeclaration = {
	usage: string;
	declaration: string;
	impl: string;
};

function buildResultType(
	resultTypes: Map<string, RustTypeDeclaration>,
	value: any,
	name: string,
) {
	if ("fieldAlias" in value) {
		if (value.sql.decoder.mapFromDriverValue === asString) return "String";

		throw new Error(
			"Unknown type for alias field. Did you forget to use `mapWith`?",
		);
	}

	if ("dataType" in value) {
		if (!(value.dataType in sqlDatatypeToRust))
			throw new Error(`Unknown datatype: ${value.dataType}`);

		let ty =
			value.columnType === "MySqlVarBinary"
				? "Vec<u8>"
				: (sqlDatatypeToRust as any)[value.dataType];
		if (!value.notNull) ty = `Option<${ty}>`;

		return ty;
	}

	if (typeof value === "object") {
		const structName = `${snakeToCamel(name)}Result`;

		const field_decls = [];
		const fields = new Map();
		for (const [k, v] of Object.entries(value)) {
			const ty = buildResultType(
				resultTypes,
				v,
				`${name}_${camelToSnakeCase(k)}`,
			);
			const tyUsage = resultTypes.get(ty)?.usage ?? ty;
			field_decls.push(`pub ${camelToSnakeCase(k)}: ${tyUsage}`);
			fields.set(k, ty);
		}

		let impl = "";
		const isALeftJoin = typeof value?.leftJoinThis === "function"; // Injected by `leftJoinHint`
		if (isALeftJoin) {
			const keys = [...fields.keys()].map((k) => camelToSnakeCase(k));

			impl = `{
				${[...fields.entries()]
					.map(([k, _ty]) => {
						return `let ${camelToSnakeCase(k)} = row.try_get("${k}");`; // We don't support furthur nesting, rn.
					})
					.join("\n")}

				match (${keys.join(", ")}) {
					(${keys.map((k) => `Ok(${k})`).join(", ")}) => {
						Some(${structName} { ${keys.join(", ")} })
					}
					_ => None,
				}
			}`;
		} else {
			impl = `${structName} {
				${[...fields.entries()]
					.map(([k, ty]) => {
						const impl = resultTypes.get(ty)?.impl ?? `row.get("${k}")`;
						return `${camelToSnakeCase(k)}: ${impl}`;
					})
					.join(",\n")}
			}`;
		}

		resultTypes.set(structName, {
			usage: isALeftJoin ? `Option<${structName}>` : structName,
			declaration: `#[derive(Debug)]\npub struct ${structName} {
				${field_decls.join(",\n")}
			}`,
			impl,
		});

		return structName;
	}

	throw new Error(`Unknown datatype value: ${value}`);
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
