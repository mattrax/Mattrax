import { noVitestMocking } from "./rules/no-vitest-mocking.ts";

const plugin = {
  meta: { name: "testing" },
  rules: { "no-vitest-mocking": noVitestMocking },
};

export default plugin;
