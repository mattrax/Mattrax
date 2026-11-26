// Only the tag, the layer and the routes are exported from the package root:
// the SOAP/SyncML/WSTEP code is imported lazily by the service, and re-exporting
// it here would put it back in every consumer's startup closure. Tools that
// operate on the wire format import the subpaths instead.
export * from "./domain.js";

export * from "./handlers.js";

export * from "./service.js";
