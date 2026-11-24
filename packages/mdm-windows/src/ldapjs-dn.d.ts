declare module "@mbakereth/ldapjs-dn" {
  export interface RelativeDistinguishedName {
    keys(): IterableIterator<string>;
    getValue(name: string): string | { readonly buffer: Uint8Array };
  }

  export interface DistinguishedName {
    readonly length: number;
    rdnAt(index: number): RelativeDistinguishedName;
  }

  export const DN: {
    fromString(value: string): DistinguishedName;
  };
}
