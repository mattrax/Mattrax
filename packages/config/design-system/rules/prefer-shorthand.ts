import {
  CLASS_FUNCTIONS,
  classSites,
  tokensOf,
  variantOf,
} from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

const SCREEN_HEIGHT = /^((?:min-|max-)?h)-screen$/;

const ARBITRARY_Z = /^z-\[-?\d+\]$/;

interface Checks {
  dvh: boolean;
  square: boolean;
  zIndex: boolean;
}

function shorthandMessages(text: string, checks: Checks) {
  const messages: string[] = [];
  const widths = new Map<string, string>();
  const heights = new Map<string, string>();
  for (const token of tokensOf(text)) {
    const variant = variantOf(token);
    const utility = token.slice(variant.length);
    const screen = SCREEN_HEIGHT.exec(utility);
    if (screen && checks.dvh) {
      messages.push(
        `${token} ignores mobile browser chrome. Use ${variant}${screen[1]}-dvh.`,
      );
    }
    if (checks.zIndex && ARBITRARY_Z.test(utility)) {
      messages.push(
        `${token} is an arbitrary z-index. Use a step on the z scale, such as ${variant}z-10.`,
      );
    }
    if (utility.startsWith("w-")) {
      widths.set(`${variant}${utility.slice(2)}`, variant);
    } else if (utility.startsWith("h-")) {
      heights.set(`${variant}${utility.slice(2)}`, variant);
    }
  }
  for (const [key, variant] of checks.square ? widths : []) {
    const value = key.slice(variant.length);
    if (heights.has(key) && value !== "screen") {
      messages.push(
        `${variant}w-${value} ${variant}h-${value} is a square. Use ${variant}size-${value}.`,
      );
    }
  }
  return messages;
}

export const preferShorthand = ratcheted<{
  dvh?: boolean;
  functions?: string[];
  square?: boolean;
  zIndex?: boolean;
}>(
  {
    dvh: { type: "boolean" },
    functions: { items: { type: "string" }, type: "array" },
    square: { type: "boolean" },
    zIndex: { type: "boolean" },
  },
  (
    _file,
    { dvh = true, functions = CLASS_FUNCTIONS, square = true, zIndex = true },
    report,
  ) =>
    classSites(functions, (strings) => {
      for (const { node, text } of strings) {
        for (const message of shorthandMessages(text, {
          dvh,
          square,
          zIndex,
        })) {
          report({ message, node });
        }
      }
    }),
);
