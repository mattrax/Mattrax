import { encode } from "uqr";

export type QrPath = {
  /** Width/height of the module grid, including the quiet-zone border. */
  readonly size: number;
  /** SVG path covering every dark module. */
  readonly path: string;
};

/**
 * Encode a value as a single SVG path. Keeping this pure makes the QR rendering
 * testable without a DOM and lets the component use one `<path>` instead of one
 * element per module.
 *
 * Error-correction level M tolerates a slightly dirty screen or print while
 * keeping enrollment URLs compact. A four-module quiet zone is required by
 * the QR spec; without it, adjacent UI can make an otherwise valid code hard
 * for a camera to lock onto.
 */
export const qrPath = (value: string): QrPath => {
  const qr = encode(value, { ecc: "M", border: 4 });
  let path = "";

  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.data[y]?.[x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }

  return { size: qr.size, path };
};
