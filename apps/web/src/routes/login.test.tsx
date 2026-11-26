// @vitest-environment happy-dom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  params: {} as Record<string, string | string[] | undefined>,
  startSso: vi.fn(),
  redirect: vi.fn(),
  passkey: vi.fn(),
  session: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useSearchParams: () => [state.params, vi.fn()],
}));
vi.mock("~/lib/navigation", () => ({ useNavigate: () => state.navigate }));
vi.mock("~/lib/auth", () => ({
  authClient: {
    useSession: () => () => ({ data: { user: undefined }, isPending: false }),
    session: state.session,
    signOut: state.signOut,
    passkeySignIn: state.passkey,
  },
}));
vi.mock("~/lib/sso-start", () => ({
  startOrganisationSso: state.startSso,
  redirectToProvider: state.redirect,
}));
vi.mock("~/components/mfa-pending", () => ({ default: () => <div>MFA required</div> }));
vi.mock("~/components/brand-logo", () => ({ default: () => null }));
vi.mock("~/components/ui/icons", () => ({ KeyRound: () => null }));

import LoginPage from "./login";

const cleanups: Array<() => void> = [];

const mount = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <LoginPage />, host);

  cleanups.push(dispose);

  return host;
};

const button = (host: HTMLElement, label: RegExp) =>
  [...host.querySelectorAll("button")].find((item) => label.test(item.textContent ?? ""));

const stubConditionalPasskey = () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: class {
      static isConditionalMediationAvailable = () => Promise.resolve(true);
    },
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: vi.fn() },
  });
};

const restoreConditionalPasskey = () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "credentials", { configurable: true, value: undefined });
};

const submitEmail = (host: HTMLElement, email = "person@example.com") => {
  const input = host.querySelector<HTMLInputElement>("#email")!;

  input.value = email;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
  host.querySelector("form")!.requestSubmit();
};

/** Drain a resolved async continuation, then apply Solid's DOM updates. */
const settleAfterResolution = async () => {
  await Promise.resolve();
  flush();
};

beforeEach(() => {
  state.params = {};
  state.startSso.mockReset();
  state.redirect.mockReset();
  state.passkey.mockReset();
  state.session.mockReset();
  state.signOut.mockReset().mockResolvedValue(undefined);
  state.navigate.mockReset();
});

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  document.body.replaceChildren();
  restoreConditionalPasskey();
  vi.clearAllMocks();
});

describe("email-first sign-in", () => {
  it("redirects automatically when the address belongs to an SSO organisation", async () => {
    state.startSso.mockResolvedValue({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    const host = mount();

    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() =>
      expect(state.redirect).toHaveBeenCalledWith(
        "https://login.microsoftonline.com/tenant/authorize",
      ),
    );
    expect(state.startSso).toHaveBeenCalledWith("ada@acme.com", undefined);
    expect(host.textContent).toContain("Redirecting to your organisation");
    expect(button(host, /sign in with your organisation/i)).toBeUndefined();
  });

  it("starts the SSO redirect for a prefilled registration address", async () => {
    state.params = { email: "ada@acme.com", created: "1" };
    state.startSso.mockResolvedValue({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    mount();

    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1));
    expect(state.startSso).toHaveBeenCalledWith("ada@acme.com", undefined);
  });

  it("never starts a second redirect for a duplicated submit", async () => {
    let resolve!: (value: unknown) => void;
    state.startSso.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    // Two submits land before the first lookup settles.
    submitEmail(host, "ada@acme.com");
    submitEmail(host, "ada@acme.com");

    expect(state.startSso).toHaveBeenCalledTimes(1);

    resolve({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1));

    expect(state.startSso).toHaveBeenCalledTimes(1);
    expect(state.redirect).toHaveBeenCalledTimes(1);
  });

  it("keeps the ordinary passkey path for a personal address", async () => {
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    const host = mount();

    submitEmail(host, "person@example.com");

    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined());
    expect(state.redirect).not.toHaveBeenCalled();
    expect(button(host, /sign in with your organisation/i)).toBeUndefined();
    expect(button(host, /use a passkey instead/i)).toBeUndefined();
    expect(host.querySelector("#sso-error")).toBeNull();
  });

  it("keeps provider failures retryable without claiming the address has no organisation", async () => {
    state.startSso
      .mockResolvedValueOnce({
        kind: "error",
        message: "We couldn't start organisation sign-in. Check your connection and try again.",
      })
      .mockResolvedValueOnce({
        kind: "redirect",
        url: "https://login.microsoftonline.com/tenant/authorize",
      });
    const host = mount();

    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() => expect(host.querySelector("#sso-error")).not.toBeNull());
    expect(host.querySelector("#sso-error")?.textContent).toContain("Check your connection");
    expect(button(host, /try organisation sign-in again/i)).toBeDefined();
    expect(button(host, /use a passkey instead/i)).toBeDefined();
    expect(state.redirect).not.toHaveBeenCalled();

    button(host, /try organisation sign-in again/i)!.click();
    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1));
  });

  it("ignores a stale SSO lookup after the email is changed", async () => {
    let resolve!: (value: unknown) => void;
    state.params = { email: "ada@acme.com", created: "1" };
    state.startSso.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1));
    button(host, /^change$/i)!.click();
    flush();

    resolve({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    await settleAfterResolution();

    expect(state.redirect).not.toHaveBeenCalled();
    expect(host.querySelector("#email")).not.toBeNull();
    expect(host.textContent).not.toContain("Redirecting to your organisation");
  });

  it("ignores a stale lookup that resolves after the first redirect", async () => {
    let resolveFirst!: (value: unknown) => void;
    state.params = { email: "ada@acme.com", created: "1" };
    state.startSso
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done;
        }),
      )
      .mockResolvedValue({
        kind: "redirect",
        url: "https://login.microsoftonline.com/tenant/authorize",
      });
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1));
    button(host, /^change$/i)!.click();
    flush();
    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1));

    resolveFirst({
      kind: "redirect",
      url: "https://login.microsoftonline.com/stale/authorize",
    });
    await settleAfterResolution();

    expect(state.redirect).toHaveBeenCalledTimes(1);
    expect(state.redirect).not.toHaveBeenCalledWith(
      "https://login.microsoftonline.com/stale/authorize",
    );
  });

  it("lets a blocked redirect fall back to changing the email", async () => {
    state.startSso.mockResolvedValue({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    // The navigation never leaves, simulating an embedded browser or blocker.
    state.redirect.mockImplementation(() => undefined);
    const host = mount();

    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() => expect(host.textContent).toContain("Redirecting to your organisation"));
    expect(button(host, /cancel and change email/i)).toBeDefined();

    button(host, /cancel and change email/i)!.click();
    flush();

    expect(host.querySelector("#email")).not.toBeNull();
    expect(host.textContent).not.toContain("Redirecting to your organisation");
  });

  it("ignores a passkey result after the email is changed", async () => {
    let resolve!: (value: unknown) => void;
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined());
    button(host, /sign in with a passkey/i)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Waiting for your device"));

    button(host, /^change$/i)!.click();
    flush();
    resolve({ error: { tag: "PasskeyCancelled", message: "raw detail" } });
    await settleAfterResolution();

    expect(host.querySelector("#login-error")).toBeNull();
    expect(host.querySelector("#email")).not.toBeNull();
    expect(host.textContent).not.toContain("raw detail");
    expect(state.redirect).not.toHaveBeenCalled();

    // The invalidated ceremony must not leave the next passkey attempt stuck
    // in its pending/disabled state.
    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /sign in with a passkey/i)).toBeDefined());
    expect(button(host, /sign in with a passkey/i)!.disabled).toBe(false);
  });

  it("signs out a stale passkey success instead of navigating", async () => {
    let resolve!: (value: unknown) => void;
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined());
    button(host, /sign in with a passkey/i)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Waiting for your device"));

    button(host, /^change$/i)!.click();
    flush();
    resolve({ data: { user: { id: "someone" } } });
    // signOut is the positive signal that the stale ceremony result was handled.
    await vi.waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
    flush();

    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(state.redirect).not.toHaveBeenCalled();
    expect(host.querySelector("#email")).not.toBeNull();
  });

  it.each([
    ["PasskeyCancelled", /cancelled or timed out/i],
    ["PasskeyNotAllowed", /If no prompt appeared/i],
    ["PasskeyNoAuthenticator", /No passkey option was available/i],
    ["PasskeyUnsupported", /can't use passkeys/i],
    ["PasskeyBlocked", /blocked passkey sign-in/i],
    ["PasskeyRejected", /wasn't accepted/i],
  ])("renders %s recovery without a misleading credential claim", async (tag, copy) => {
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockResolvedValue({ error: { tag, message: "raw detail" } });
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined());
    flush();

    button(host, /passkey/i)!.click();

    await vi.waitFor(() => expect(host.querySelector("#login-error")).not.toBeNull());
    expect(host.querySelector("#login-error")?.textContent).toMatch(copy);
    expect(host.textContent).not.toContain("raw detail");
    expect(button(host, /try passkey again/i)).toBeDefined();

    if (tag !== "PasskeyRejected")
      expect(host.querySelector("#login-error")?.textContent).not.toContain("wasn't accepted");
  });
});

describe("sign-in progress", () => {
  it("shows one loading indicator while the organisation lookup is in flight", async () => {
    let resolve!: (value: unknown) => void;
    state.startSso.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() => expect(button(host, /checking/i)).toBeDefined());
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    expect(host.textContent).not.toContain("Checking your organisation");

    resolve({ kind: "unavailable" });
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined());
  });

  it("shows the account preview only once the lookup has settled", async () => {
    state.params = { email: "ada@acme.com", created: "1" };
    let resolve!: (value: unknown) => void;
    state.startSso.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1));
    expect(host.textContent).not.toContain("ada@acme.com");
    expect(button(host, /^change$/i)).toBeDefined();

    resolve({ kind: "unavailable" });
    await vi.waitFor(() => expect(host.textContent).toContain("ada@acme.com"));
  });

  it("hides the account preview while a passkey sign-in is pending", async () => {
    let resolve!: (value: unknown) => void;
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /sign in with a passkey/i)).toBeDefined());
    expect(host.textContent).toContain("person@example.com");

    button(host, /sign in with a passkey/i)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Waiting for your device"));
    expect(host.textContent).not.toContain("person@example.com");

    resolve({ error: { tag: "PasskeyCancelled" } });
    await vi.waitFor(() => expect(host.textContent).toContain("person@example.com"));
    expect(host.querySelector("#login-error")).not.toBeNull();
  });
});

describe("conditional passkey autofill", () => {
  it("starts on the email step and completes a chosen passkey", async () => {
    stubConditionalPasskey();
    let resolve!: (value: unknown) => void;
    state.passkey.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    await vi.waitFor(() => expect(state.passkey).toHaveBeenCalledTimes(1));
    const { conditional } = state.passkey.mock.calls[0]![0] as { conditional: AbortSignal };

    expect(conditional).toBeInstanceOf(AbortSignal);
    expect(conditional.aborted).toBe(false);

    resolve({ data: { user: { id: "person" } } });

    await vi.waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith("/dashboard", { replace: true }),
    );
    expect(host.querySelector("#login-error")).toBeNull();
  });

  it("aborts the inline request when the email changes", async () => {
    stubConditionalPasskey();
    state.passkey.mockReturnValue(new Promise(() => {}));
    const host = mount();

    await vi.waitFor(() => expect(state.passkey).toHaveBeenCalledTimes(1));
    const { conditional } = state.passkey.mock.calls[0]![0] as { conditional: AbortSignal };
    const input = host.querySelector<HTMLInputElement>("#email")!;

    input.value = "p";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();

    expect(conditional.aborted).toBe(true);
  });

  it("stays quiet when the inline passkey sheet is dismissed", async () => {
    stubConditionalPasskey();
    let resolve!: (value: unknown) => void;
    state.passkey.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const host = mount();

    await vi.waitFor(() => expect(state.passkey).toHaveBeenCalledTimes(1));
    resolve({ error: { tag: "PasskeyNotAllowed", message: "raw detail" } });
    await settleAfterResolution();

    expect(host.querySelector("#login-error")).toBeNull();
    expect(host.textContent).not.toContain("raw detail");
    expect(host.textContent).not.toContain("wasn't completed");
  });

  it("does not start on the account step", async () => {
    stubConditionalPasskey();
    state.params = { email: "person@example.com", created: "1" };
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1));
    // The account preview appears only once the lookup has settled.
    await vi.waitFor(() => expect(host.textContent).toContain("person@example.com"));
    flush();

    expect(state.passkey).not.toHaveBeenCalled();
    expect(button(host, /sign in with a passkey/i)).toBeDefined();
  });
});
