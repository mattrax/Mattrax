import { DOMParser } from "@xmldom/xmldom";

/**
 * Node has no DOMParser. The ADMX parser deliberately uses the platform parser
 * (the browser supplies one, and the CJS xmldom import cannot be loaded by
 * Solid's SSR runner), so tests install xmldom here.
 */
Object.defineProperty(globalThis, "DOMParser", { value: DOMParser, configurable: true });
