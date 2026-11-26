// @vitest-environment happy-dom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorder } from "../../../../packages/config/testing/recorder.ts";
import type { authClient } from "~/lib/auth";
import type { rememberRegistrationNonce } from "~/lib/registration-nonce";
import RegisterPage from "./register";
import type { RegisterPageDeps } from "./register";

/** Fakes are rebuilt each test so no implementation or call leaks into another. */
const makeState = () => ({
  requestCode: recorder<
    Parameters<typeof authClient.requestRegistrationCode>,
    ReturnType<typeof authClient.requestRegistrationCode>
  >(),
  verifyCode: recorder<
    Parameters<typeof authClient.verifyRegistrationCode>,
    ReturnType<typeof authClient.verifyRegistrationCode>
  >(),
  register: recorder<
    Parameters<typeof authClient.register>,
    ReturnType<typeof authClient.register>
  >(),
  requestEmailVerification: recorder<
    Parameters<typeof authClient.requestEmailVerification>,
    ReturnType<typeof authClient.requestEmailVerification>
  >(async () => ({ data: { status: "ok" } })),
  navigate: recorder<[href: string, options?: { readonly replace?: boolean }], void>(),
  signOut: recorder<[], ReturnType<typeof authClient.signOut>>(async () => ({
    data: { status: "ok" },
  })),
  session: recorder<[], ReturnType<typeof authClient.session>>(async () => ({ data: null })),
  rememberNonce: recorder<Parameters<typeof rememberRegistrationNonce>, void>(),
});

let state = makeState();

/** Dependencies live on the page's props instead of replacing imported modules. */
const deps = (): RegisterPageDeps => ({
  searchParams: {},
  navigate: state.navigate,
  session: () => ({ data: { user: undefined }, isPending: false }),
  auth: {
    requestRegistrationCode: state.requestCode,
    verifyRegistrationCode: state.verifyCode,
    register: state.register,
    requestEmailVerification: state.requestEmailVerification,
    session: state.session,
    signOut: state.signOut,
  },
  registrationNonce: { read: () => "nonce-1", remember: state.rememberNonce },
});

const cleanups: Array<() => void> = [];

const mount = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <RegisterPage deps={deps()} />, host);

  cleanups.push(dispose);

  return host;
};

const input = (host: HTMLElement, selector: string) =>
  host.querySelector<HTMLInputElement>(selector)!;

const setInput = (element: HTMLInputElement, value: string) => {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
};

const fillIdentity = (host: HTMLElement) => {
  setInput(input(host, "#name"), "Ada Lovelace");
  setInput(input(host, "#email"), "ada@example.com");
};

beforeEach(() => {
  state = makeState();
});

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  document.body.replaceChildren();
});

describe("sign-up Email Verification API", () => {
  it("marks the email input and binds the hidden token input to the session nonce", () => {
    const host = mount();
    const email = input(host, "#email");
    const token = input(host, 'input[name="token"]');

    expect(email.type).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(token.type).toBe("hidden");
    expect(token.getAttribute("autocomplete")).toBe("email-verification-token");
    expect(token.getAttribute("nonce")).toBe("nonce-1");
  });

  it("submits a browser-filled token with the nonce", async () => {
    state.requestCode.mockResolvedValue({ data: { status: "ok", emailSent: true } });
    const host = mount();

    fillIdentity(host);
    input(host, 'input[name="token"]').value = "evt-token";
    host.querySelector("form")!.requestSubmit();

    await vi.waitFor(
      () =>
        expect(state.requestCode).toHaveBeenCalledWith({
          name: "Ada Lovelace",
          email: "ada@example.com",
          token: "evt-token",
          nonce: "nonce-1",
        }),
      { interval: 1 },
    );
  });

  it("skips the code and goes straight to passkey creation when the token verified", async () => {
    state.requestCode.mockResolvedValue({
      data: {
        status: "ok",
        emailSent: false,
        verified: true,
        grant: "grant-1",
        nonce: "nonce-2",
      },
    });
    state.register.mockResolvedValue({ data: { signedIn: true } });
    const host = mount();

    fillIdentity(host);
    input(host, 'input[name="token"]').value = "evt-token";
    host.querySelector("form")!.requestSubmit();

    await vi.waitFor(
      () =>
        expect(state.register).toHaveBeenCalledWith({
          name: "Ada Lovelace",
          email: "ada@example.com",
          grant: "grant-1",
        }),
      { interval: 1 },
    );
    expect(host.querySelector("#verification-code")).toBeNull();
    expect(input(host, 'input[name="token"]').getAttribute("nonce")).toBe("nonce-2");
  });

  it("falls back to the emailed code with no token", async () => {
    state.requestCode.mockResolvedValue({ data: { status: "ok", emailSent: true } });
    const host = mount();

    fillIdentity(host);
    host.querySelector("form")!.requestSubmit();

    await vi.waitFor(() => expect(host.querySelector("#verification-code")).not.toBeNull(), {
      interval: 1,
    });
    expect(state.requestCode).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(state.register).not.toHaveBeenCalled();
  });

  it("rotates the nonce after a failed token attempt and keeps the code path", async () => {
    state.requestCode.mockResolvedValue({
      data: { status: "ok", emailSent: true, nonce: "nonce-2" },
    });
    const host = mount();

    fillIdentity(host);
    const token = input(host, 'input[name="token"]');
    token.value = "stale-token";
    host.querySelector("form")!.requestSubmit();

    await vi.waitFor(() => expect(host.querySelector("#verification-code")).not.toBeNull(), {
      interval: 1,
    });
    expect(token.getAttribute("nonce")).toBe("nonce-2");
    // A consumed token cannot ride into the resend with the old nonce.
    expect(token.value).toBe("");
    expect(state.register).not.toHaveBeenCalled();
  });
});
