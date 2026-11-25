// @vitest-environment happy-dom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  register: vi.fn(),
  requestEmailVerification: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useSearchParams: () => [{}, vi.fn()],
}));
vi.mock("~/lib/navigation", () => ({ useNavigate: () => state.navigate }));
vi.mock("~/lib/registration-nonce", () => ({
  readRegistrationNonce: () => "nonce-1",
  rememberRegistrationNonce: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({
  authClient: {
    useSession: () => () => ({ data: { user: undefined }, isPending: false }),
    requestRegistrationCode: state.requestCode,
    verifyRegistrationCode: state.verifyCode,
    register: state.register,
    requestEmailVerification: state.requestEmailVerification,
    session: vi.fn().mockResolvedValue({ data: null }),
    signOut: state.signOut,
  },
}));
vi.mock("~/components/brand-logo", () => ({ BrandLogo: () => null }));

import RegisterPage from "./register";

const cleanups: Array<() => void> = [];

const mount = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <RegisterPage />, host);

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
  state.requestCode.mockReset();
  state.verifyCode.mockReset();
  state.register.mockReset();
  state.requestEmailVerification.mockReset().mockResolvedValue({ data: { status: "ok" } });
  state.navigate.mockReset();
  state.signOut.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  document.body.replaceChildren();
  vi.clearAllMocks();
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

    await vi.waitFor(() =>
      expect(state.requestCode).toHaveBeenCalledWith({
        name: "Ada Lovelace",
        email: "ada@example.com",
        token: "evt-token",
        nonce: "nonce-1",
      }),
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

    await vi.waitFor(() =>
      expect(state.register).toHaveBeenCalledWith({
        name: "Ada Lovelace",
        email: "ada@example.com",
        grant: "grant-1",
      }),
    );
    expect(host.querySelector("#verification-code")).toBeNull();
    expect(input(host, 'input[name="token"]').getAttribute("nonce")).toBe("nonce-2");
  });

  it("falls back to the emailed code with no token", async () => {
    state.requestCode.mockResolvedValue({ data: { status: "ok", emailSent: true } });
    const host = mount();

    fillIdentity(host);
    host.querySelector("form")!.requestSubmit();

    await vi.waitFor(() => expect(host.querySelector("#verification-code")).not.toBeNull());
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

    await vi.waitFor(() => expect(host.querySelector("#verification-code")).not.toBeNull());
    expect(token.getAttribute("nonce")).toBe("nonce-2");
    // A consumed token cannot ride into the resend with the old nonce.
    expect(token.value).toBe("");
    expect(state.register).not.toHaveBeenCalled();
  });
});
