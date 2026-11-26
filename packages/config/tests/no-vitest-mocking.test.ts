import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import { noVitestMocking } from "../testing/rules/no-vitest-mocking.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const message = (method: string) =>
  "vi." +
  method +
  "() replaces dependencies outside the Effect service graph. Provide a Layer / Context service fake instead.";

tester.run("testing/no-vitest-mocking", noVitestMocking, {
  valid: [
    { code: "vi.mock('./x')", filename: "src/app.ts" },
    { code: "const vi = { mock() {} }; vi.mock();", filename: "src/app.test.ts" },
    { code: "const fake = () => Effect.succeed(1);", filename: "src/app.test.ts" },
  ],
  invalid: [
    { code: "vi.mock('./email')", filename: "src/app.test.ts", errors: [{ message: message("mock") }] },
    { code: "vi.spyOn(Date, 'now')", filename: "src/app.test.ts", errors: [{ message: message("spyOn") }] },
    { code: "vi['doMock']('./x')", filename: "src/app.test.ts", errors: [{ message: message("doMock") }] },
    { code: "import { vi as v } from 'vitest'; v.mock('./x')", filename: "src/app.test.ts", errors: [{ message: message("mock") }] },
    { code: "vi.fn()", filename: "src/app.test.ts", errors: [{ message: message("fn") }] },
  ],
});
