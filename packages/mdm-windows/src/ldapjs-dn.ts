// @ts-expect-error -- @mbakereth/ldapjs-dn publishes no TypeScript declarations.
import { DN as untypedDN } from "@mbakereth/ldapjs-dn";

export interface RelativeDistinguishedName {
  keys(): IterableIterator<string>;
  getValue(name: string): string | { readonly buffer: Uint8Array };
}

export interface DistinguishedName {
  readonly length: number;
  rdnAt(index: number): RelativeDistinguishedName;
}

export const DN = untypedDN as {
  fromString(value: string): DistinguishedName;
};
