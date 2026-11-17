export { DEPLOYMENT_HEADER, DEPLOYMENT_META_NAME } from "./deployment-meta";

/**
 * The id of the build currently serving this process. The Vite config replaces
 * `__MATTRAX_BUILD_ID__` at build time; the fallback keeps unit tests and
 * bare-bones tooling working when they import a module that pulls this in.
 */
export const DEPLOYMENT_ID =
  typeof __MATTRAX_BUILD_ID__ === "undefined" ? "development" : __MATTRAX_BUILD_ID__;
