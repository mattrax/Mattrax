import type { Config } from "@planetscale/database";
import {
	type FieldPacket,
	type PoolConnection,
	type QueryResult,
	type ResultSetHeader,
	createPool,
} from "mysql2/promise";

export function createFetchHandler(uri: string): NonNullable<Config["fetch"]> {
	const pool = createPool({ uri, rowsAsArray: true });
	const enc = new TextEncoder();
	const transactions = new Map<string, PoolConnection>();

	return async (input, init) => {
		if (input.endsWith("/Execute")) {
			const req: {
				query: string;
				session: string | null;
			} = JSON.parse(init!.body);

			if (req.query === "BEGIN") {
				const conn = await pool.getConnection();
				await conn.beginTransaction();
				const id = crypto.randomUUID();
				transactions.set(id, conn);

				return Response.json({ session: id, result: {}, timing: 0 });
			}

			let result: [QueryResult, FieldPacket[]];
			if (req.session) {
				if (req.query === "COMMIT") {
					const conn = transactions.get(req.session);
					if (conn) {
						await conn.commit();
						conn.release();
						transactions.delete(req.session);
					}
					return Response.json({ session: req.session, result: {}, timing: 0 });
				}

				if (req.query === "ROLLBACK") {
					const conn = transactions.get(req.session);
					if (conn) {
						await conn.rollback();
						conn.release();
						transactions.delete(req.session);
					}
					return Response.json({ session: req.session, result: {}, timing: 0 });
				}

				result = await transactions.get(req.session)!.execute(req.query, []);
			} else {
				result = await pool.execute(req.query, []);
			}
			const [results, resultFields] = result;

			const fields = (resultFields || []).map((f) => {
				const flags = parseFlags(f.flags);
				return {
					name: f.name,
					type: parseColumn(f.type || f.columnType || 0, flags),
					charset: f.characterSet ?? null,
					flags,
				};
			});
			for (const field of fields) {
				field.type ||= "NULL";
			}

			let rows: any[] = [];
			let rowsAffected = "0";
			let insertId = null;
			if (isResultSetHeader(results)) {
				rowsAffected = String(results.affectedRows);
				insertId = String(results.insertId);
			} else {
				rows = (results as object[]).map((r) => {
					const lengths: number[] = [];
					let result: ArrayBufferLike = new Uint8Array(0);
					let currentOffset = 0;
					let i = 0;
					for (const [_, v] of Object.entries(r)) {
						const field = fields[i]!;
						i += 1;

						if (v === null) {
							lengths.push(-1);
							continue;
						}

						let buf: Uint8Array;

						if (
							typeof v === "string" ||
							typeof v === "number" ||
							typeof v === "boolean"
						) {
							buf = enc.encode(String(v));
						} else if (v instanceof Uint8Array) {
							buf = v;
						} else if (v instanceof Date) {
							let vv = `${v.getFullYear()}-${`0${v.getMonth() + 1}`.slice(
								-2,
							)}-${`0${v.getDate()}`.slice(-2)}`;

							if (field.type !== "DATETIME") {
								vv = `${vv} ${`0${v.getHours()}`.slice(
									-2,
								)}:${`0${v.getMinutes()}`.slice(
									-2,
								)}:${`0${v.getSeconds()}`.slice(-2)}`;
							}

							buf = enc.encode(vv);
						} else if (typeof v === "object" && field.type === "JSON") {
							buf = enc.encode(JSON.stringify(v));
						} else {
							throw new Error(`unexpected type '${typeof v}' with value: ${v}`);
						}

						lengths.push(buf.length);
						result = appendBuffer(result, buf);
						currentOffset += buf.length;
					}

					return {
						lengths,
						values: Buffer.from(result).toString("base64"),
					};
				});
			}

			return Response.json({
				session: req.session,
				result: {
					rowsAffected,
					insertId,
					fields,
					rows,
				},
				timing: 0,
			});
		}

		throw new Error(`requested unimplemented endpoint: ${input}`);
	};
}

function appendBuffer(buffer1: ArrayBufferLike, buffer2: ArrayBufferLike) {
	const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
	tmp.set(new Uint8Array(buffer1), 0);
	tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
	return tmp.buffer;
}

// mysql2 docs show this. I hate it.
const isResultSetHeader = (data: unknown): data is ResultSetHeader => {
	if (!data || typeof data !== "object" || Array.isArray(data)) return false;

	const keys = [
		"fieldCount",
		"affectedRows",
		"insertId",
		"info",
		"serverStatus",
		"warningStatus",
		"changedRows",
	];

	return keys.every((key) => key in data);
};

const lookupFlags = {
	NOT_NULL: 1 /* Field can't be NULL */,
	PRI_KEY: 2 /* Field is part of a primary key */,
	UNIQUE_KEY: 4 /* Field is part of a unique key */,
	MULTIPLE_KEY: 8 /* Field is part of a key */,
	BLOB: 16 /* Field is a blob */,
	UNSIGNED: 32 /* Field is unsigned */,
	ZEROFILL: 64 /* Field is zerofill */,
	BINARY: 128 /* Field is binary   */,

	/* The following are only sent to new clients */
	ENUM: 256 /* field is an enum */,
	AUTO_INCREMENT: 512 /* field is a autoincrement field */,
	TIMESTAMP: 1024 /* Field is a timestamp */,
	SET: 2048 /* field is a set */,
	NO_DEFAULT_VALUE: 4096 /* Field doesn't have default value */,
	ON_UPDATE_NOW: 8192 /* Field is set to NOW on UPDATE */,
	NUM: 32768 /* Field is num (for clients) */,
};

function parseFlags(flags: number | string[]) {
	if (typeof flags === "number") return flags;

	let flag = 0;
	for (const f of flags) {
		const v = lookupFlags?.[f as keyof typeof lookupFlags];
		if (v) flag |= v;
	}
	return flag;
}

// Convert MySQL column types to Vitess column types
//
// Ref:
// - https://github.com/vitessio/vitess/blob/9e40015748ede158357bd7291f583db138abc3df/go/sqltypes/type.go#L142
// - https://vitess.io/files/version-pdfs/Vitess-Docs-6.0-04-29-2020.pdf
function parseColumn(c: number, flags: number) {
	const isSigned = !(flags & lookupFlags.UNSIGNED);
	const isBinary = flags & lookupFlags.BINARY;

	if (flags & lookupFlags.ENUM) return "ENUM";
	if (flags & lookupFlags.SET) return "SET";

	if (c === 0) return "DECIMAL";
	if (c === 1) return isSigned ? "INT8" : "UINT8";
	if (c === 2) return isSigned ? "INT16" : "UINT16";
	if (c === 3) return isSigned ? "INT32" : "UINT32";
	if (c === 4) return "FLOAT32";
	if (c === 5) return "FLOAT64";
	if (c === 6) return "NULL";
	if (c === 7) return "TIMESTAMP";
	if (c === 8) return isSigned ? "INT64" : "UINT64";
	if (c === 9) return isSigned ? "INT24" : "UINT24";
	if (c === 10) return "DATE";
	if (c === 11) return "TIME";
	if (c === 12) return "DATETIME";
	if (c === 13) return "YEAR";
	if (c === 14) throw new Error("Internal MySql type");
	if (c === 15) return "VARCHAR";
	if (c === 16) return "BIT";
	if (c === 17) throw new Error("todo: TIMESTAMP2");
	if (c === 18) throw new Error("todo: DATETIME2");
	if (c === 19) throw new Error("todo: TIME2");
	if (c === 20) throw new Error("Used for replication only.");
	if (c === 243) throw new Error("todo: UNKNOWN");
	if (c === 245) return "JSON";
	if (c === 246) throw new Error("todo: NEWDECIMAL");
	if (c === 247) return "ENUM";
	if (c === 248) return "SET";
	if (c === 249 || c === 250 || c === 251 || c === 252)
		return isBinary ? "BLOB" : "TEXT";
	if (c === 253) return isBinary ? "VARBINARY" : "VARCHAR";
	if (c === 254) return isBinary ? "BINARY" : "CHAR";
	if (c === 255) return "GEOMETRY";

	throw new Error(`Found unknown column type: ${c}`);
}
