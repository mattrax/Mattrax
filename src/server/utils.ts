// @ts-expect-error: No types :(
import { int_to_base58 } from "base58";

// TODO: Should we encrypt them???
export const encodeId = (prefix: string, id: number) =>
  prefix ? `${prefix}_${int_to_base58(id)}` : int_to_base58(id);
