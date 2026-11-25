import config from "./packages/config/oxlint.config.ts";

/**
 * Repository oxlint config.
 *
 * The rules live in `@mattrax/config` so every app, package and tooling script
 * shares one policy; this file remains the root entry point oxlint discovers.
 * Type-aware rules stay on; compiler diagnostics are already covered by the
 * repository `tsc -b` build, and linting test fixtures through a production
 * tsconfig produces false errors.
 */
export default {
  ...config,
  // Registers @shadcn/lint so its rules are available. No shadcn rules are
  // enabled yet; add them to `rules:` here once the policies are chosen.
  jsPlugins: ["@shadcn/lint"],
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
    typeCheck: false,
  },
};

export { lintConfig } from "./packages/config/oxlint.config.ts";
