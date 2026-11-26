import { describe, expect, it } from "vitest";
import * as portable from "./index.ts";
import * as smtp from "./smtp.ts";

describe("email package exports", () => {
  it("keeps the SMTP runtime adapter out of the portable root", () => {
    expect(portable).not.toHaveProperty("smtpEmailTransport");
    expect(portable).not.toHaveProperty("sendSmtpMail");
    expect(smtp.smtpEmailTransport).toBeTypeOf("function");
  });
});
