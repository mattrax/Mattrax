/**
 * MySQL's driver pulls `iconv-lite` for every character set Node's `Buffer`
 * does not implement natively. Mattrax stores everything as `utf8mb4` and the
 * driver already handles utf8/latin1/ascii with `Buffer`, so the ~200 KB of
 * generated encoding tables exist only for charsets the product never selects.
 *
 * MySQL also uses `cesu8` on the wire for the handshake (CESU-8 differs from
 * UTF-8 only in how surrogate pairs are encoded, and the handshake is ASCII),
 * which is why it is mapped explicitly rather than passed through.
 *
 * Anything else falls back to UTF-8: the connection charset is `utf8mb4`, so a
 * value in another charset would already be a schema error, and decoding it as
 * UTF-8 keeps the failure visible instead of shipping legacy tables.
 */
const native = (encoding: string): BufferEncoding => {
  const name = encoding.toLowerCase();

  if (name === "cesu8" || name.startsWith("utf8") || name.startsWith("utf8")) return "utf8";

  // SAFETY: `Buffer.isEncoding` is the runtime guard the return type relies on.
  return Buffer.isEncoding(name) ? name : "utf8";
};

export const getDecoder = (encoding: string) => ({
  write: (buffer: Buffer) => buffer.toString(native(encoding)),
  end: () => "",
});

export const getEncoder = (encoding: string) => ({
  write: (value: string) => Buffer.from(value, native(encoding)),
  end: () => Buffer.alloc(0),
});

export const encodingExists = (encoding: string) => Buffer.isEncoding(native(encoding));

export const decode = (buffer: Buffer, encoding: string) => buffer.toString(native(encoding));

export const encode = (value: string, encoding: string) => Buffer.from(value, native(encoding));
