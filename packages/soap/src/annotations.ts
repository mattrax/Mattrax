import type { Schema } from "effect";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      /** Override the XML element name for this schema or property */
      readonly soapElementName?: string | undefined;
      /** Namespace URI for this element */
      readonly soapNamespace?: string | undefined;
      /** Namespace prefix to use (e.g. "s", "a", "wsse") */
      readonly soapNamespacePrefix?: string | undefined;
      /** Whether this property should be serialized as an XML attribute */
      readonly soapAttribute?: boolean | undefined;
      /** Override the XML attribute name (defaults to property key) */
      readonly soapAttributeName?: string | undefined;
      /** For optional fields, render as xsi:nil="true" when absent/null */
      readonly soapOptionalNil?: boolean | undefined;
      /** Whether this property maps to the parent element's text content */
      readonly soapTextContent?: boolean | undefined;
    }
  }
}

export type SoapAnnotations = NonNullable<Schema.Annotations.Annotations>;
