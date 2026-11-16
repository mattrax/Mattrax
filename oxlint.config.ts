/**
 * Repository oxlint config.
 *
 * The rules live in `@mattrax/config` so every app, package and tooling script
 * shares one policy; this file remains the root entry point oxlint discovers.
 */
export { antiSlopLint, default } from "./packages/config/oxlint.config.ts";
