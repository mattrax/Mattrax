// @vitest-environment happy-dom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorder } from "../../../../packages/config/testing/recorder.ts";
import type { PasskeyFlowOptions, authClient } from "~/lib/auth";
import type { redirectToProvider, startOrganisationSso } from "~/lib/sso-start";
import LoginPage from "./login";
import type { LoginPageDeps } from "./login";

type SsoResult = Awaited<ReturnType<typeof startOrganisationSso>>;
type PasskeyResult = Awaited<ReturnType<typeof authClient.passkeySignIn>>;

const deferred = <A,>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const signedIn = (id: string): PasskeyResult => ({
  data: { user: { id, name: "Person", email: "person@example.com", emailVerified: true } },
});

/** Fakes are rebuilt each test so no implementation or call leaks into another. */
const makeState = () => ({
  params: {} as Record<string, string | string[] | undefined>,
  startSso: recorder<[email: string, returnTo?: string], ReturnType<typeof startOrganisationSso>>(
    async () => ({ kind: "unavailable" }),
  ),
  redirect: recorder<Parameters<typeof redirectToProvider>, void>(),
  passkey: recorder<[options?: PasskeyFlowOptions], ReturnType<typeof authClient.passkeySignIn>>(
    async () => ({ error: { tag: "PasskeyUnsupported" } }),
  ),
  session: recorder<[], ReturnType<typeof authClient.session>>(async () => ({ data: null })),
  signOut: recorder<[], ReturnType<typeof authClient.signOut>>(async () => ({
    data: { status: "ok" },
  })),
  navigate: recorder<[href: string, options?: { readonly replace?: boolean }], void>(),
});

let state = makeState();

/** Dependencies live on the page's props instead of replacing imported modules. */
const deps = (): LoginPageDeps => ({
  searchParams: state.params,
  navigate: state.navigate,
  session: () => ({ data: { user: undefined }, isPending: false }),
  auth: {
    passkeySignIn: state.passkey,
    session: state.session,
    signOut: state.signOut,
  },
  sso: { start: state.startSso, redirect: state.redirect },
});

const cleanups: Array<() => void> = [];

const mount = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <LoginPage deps={deps()} />, host);

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
    value: { get: recorder() },
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
  state = makeState();
});

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  document.body.replaceChildren();
  restoreConditionalPasskey();
});

describe("email-first sign-in", () => {
  it("redirects automatically when the address belongs to an SSO organisation", async () => {
    state.startSso.mockResolvedValue({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    const host = mount();

    submitEmail(host, "ada@acme.com");

    await vi.waitFor(
      () =>
        expect(state.redirect).toHaveBeenCalledWith(
          "https://login.microsoftonline.com/tenant/authorize",
        ),
      { interval: 1 },
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

    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1), { interval: 1 });
    expect(state.startSso).toHaveBeenCalledWith("ada@acme.com", undefined);
  });

  it("never starts a second redirect for a duplicated submit", async () => {
    const lookup = deferred<SsoResult>();
    state.startSso.mockReturnValue(lookup.promise);
    const host = mount();

    // Two submits land before the first lookup settles.
    submitEmail(host, "ada@acme.com");
    submitEmail(host, "ada@acme.com");

    expect(state.startSso).toHaveBeenCalledTimes(1);

    lookup.resolve({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1), { interval: 1 });

    expect(state.startSso).toHaveBeenCalledTimes(1);
    expect(state.redirect).toHaveBeenCalledTimes(1);
  });

  it("keeps the ordinary passkey path for a personal address", async () => {
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    const host = mount();

    submitEmail(host, "person@example.com");

    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined(), { interval: 1 });
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

    await vi.waitFor(() => expect(host.querySelector("#sso-error")).not.toBeNull(), {
      interval: 1,
    });
    expect(host.querySelector("#sso-error")?.textContent).toContain("Check your connection");
    expect(button(host, /try organisation sign-in again/i)).toBeDefined();
    expect(button(host, /use a passkey instead/i)).toBeDefined();
    expect(state.redirect).not.toHaveBeenCalled();

    button(host, /try organisation sign-in again/i)!.click();
    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1), { interval: 1 });
  });

  it("ignores a stale SSO lookup after the email is changed", async () => {
    const lookup = deferred<SsoResult>();
    state.params = { email: "ada@acme.com", created: "1" };
    state.startSso.mockReturnValue(lookup.promise);
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1), { interval: 1 });
    button(host, /^change$/i)!.click();
    flush();

    lookup.resolve({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    await settleAfterResolution();

    expect(state.redirect).not.toHaveBeenCalled();
    expect(host.querySelector("#email")).not.toBeNull();
    expect(host.textContent).not.toContain("Redirecting to your organisation");
  });

  it("ignores a stale lookup that resolves after the first redirect", async () => {
    const first = deferred<SsoResult>();
    state.params = { email: "ada@acme.com", created: "1" };
    state.startSso.mockReturnValueOnce(first.promise).mockResolvedValue({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1), { interval: 1 });
    button(host, /^change$/i)!.click();
    flush();
    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1), { interval: 1 });

    first.resolve({
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

    await vi.waitFor(() => expect(host.textContent).toContain("Redirecting to your organisation"), {
      interval: 1,
    });
    expect(button(host, /cancel and change email/i)).toBeDefined();

    button(host, /cancel and change email/i)!.click();
    flush();

    expect(host.querySelector("#email")).not.toBeNull();
    expect(host.textContent).not.toContain("Redirecting to your organisation");
  });

  it("ignores a passkey result after the email is changed", async () => {
    const ceremony = deferred<PasskeyResult>();
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockReturnValue(ceremony.promise);
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined(), { interval: 1 });
    button(host, /sign in with a passkey/i)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Waiting for your device"), {
      interval: 1,
    });

    button(host, /^change$/i)!.click();
    flush();
    ceremony.resolve({ error: { tag: "PasskeyCancelled", message: "raw detail" } });
    await settleAfterResolution();

    expect(host.querySelector("#login-error")).toBeNull();
    expect(host.querySelector("#email")).not.toBeNull();
    expect(host.textContent).not.toContain("raw detail");
    expect(state.redirect).not.toHaveBeenCalled();

    // The invalidated ceremony must not leave the next passkey attempt stuck
    // in its pending/disabled state.
    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /sign in with a passkey/i)).toBeDefined(), {
      interval: 1,
    });
    expect(button(host, /sign in with a passkey/i)!.disabled).toBe(false);
  });

  it("signs out a stale passkey success instead of navigating", async () => {
    const ceremony = deferred<PasskeyResult>();
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockReturnValue(ceremony.promise);
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined(), { interval: 1 });
    button(host, /sign in with a passkey/i)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Waiting for your device"), {
      interval: 1,
    });

    button(host, /^change$/i)!.click();
    flush();
    ceremony.resolve(signedIn("someone"));
    // signOut is the positive signal that the stale ceremony result was handled.
    await vi.waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1), { interval: 1 });
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
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined(), { interval: 1 });
    flush();

    button(host, /passkey/i)!.click();

    await vi.waitFor(() => expect(host.querySelector("#login-error")).not.toBeNull(), {
      interval: 1,
    });
    expect(host.querySelector("#login-error")?.textContent).toMatch(copy);
    expect(host.textContent).not.toContain("raw detail");
    expect(button(host, /try passkey again/i)).toBeDefined();

    if (tag !== "PasskeyRejected")
      expect(host.querySelector("#login-error")?.textContent).not.toContain("wasn't accepted");
  });
});

describe("sign-in progress", () => {
  it("shows one loading indicator while the organisation lookup is in flight", async () => {
    const lookup = deferred<SsoResult>();
    state.startSso.mockReturnValue(lookup.promise);
    const host = mount();

    submitEmail(host, "ada@acme.com");

    await vi.waitFor(() => expect(button(host, /checking/i)).toBeDefined(), { interval: 1 });
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    expect(host.textContent).not.toContain("Checking your organisation");

    lookup.resolve({ kind: "unavailable" });
    await vi.waitFor(() => expect(button(host, /passkey/i)).toBeDefined(), { interval: 1 });
  });

  it("shows the account preview only once the lookup has settled", async () => {
    const lookup = deferred<SsoResult>();
    state.params = { email: "ada@acme.com", created: "1" };
    state.startSso.mockReturnValue(lookup.promise);
    const host = mount();

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1), { interval: 1 });
    expect(host.textContent).not.toContain("ada@acme.com");
    expect(button(host, /^change$/i)).toBeDefined();

    lookup.resolve({ kind: "unavailable" });
    await vi.waitFor(() => expect(host.textContent).toContain("ada@acme.com"), { interval: 1 });
  });

  it("hides the account preview while a passkey sign-in is pending", async () => {
    const ceremony = deferred<PasskeyResult>();
    state.startSso.mockResolvedValue({ kind: "unavailable" });
    state.passkey.mockReturnValue(ceremony.promise);
    const host = mount();

    submitEmail(host, "person@example.com");
    await vi.waitFor(() => expect(button(host, /sign in with a passkey/i)).toBeDefined(), {
      interval: 1,
    });
    expect(host.textContent).toContain("person@example.com");

    button(host, /sign in with a passkey/i)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Waiting for your device"), {
      interval: 1,
    });
    expect(host.textContent).not.toContain("person@example.com");

    ceremony.resolve({ error: { tag: "PasskeyCancelled" } });
    await vi.waitFor(() => expect(host.textContent).toContain("person@example.com"), {
      interval: 1,
    });
    expect(host.querySelector("#login-error")).not.toBeNull();
  });
});

describe("conditional passkey autofill", () => {
  it("starts on the email step and completes a chosen passkey", async () => {
    stubConditionalPasskey();
    const ceremony = deferred<PasskeyResult>();
    state.passkey.mockReturnValue(ceremony.promise);
    const host = mount();

    await vi.waitFor(() => expect(state.passkey).toHaveBeenCalledTimes(1), { interval: 1 });
    const { conditional } = state.passkey.mock.calls[0]![0] as { conditional: AbortSignal };

    expect(conditional).toBeInstanceOf(AbortSignal);
    expect(conditional.aborted).toBe(false);

    ceremony.resolve(signedIn("person"));

    await vi.waitFor(
      () => expect(state.navigate).toHaveBeenCalledWith("/dashboard", { replace: true }),
      { interval: 1 },
    );
    expect(host.querySelector("#login-error")).toBeNull();
  });

  it("aborts the inline request when the email changes", async () => {
    stubConditionalPasskey();
    state.passkey.mockReturnValue(new Promise<PasskeyResult>(() => {}));
    const host = mount();

    await vi.waitFor(() => expect(state.passkey).toHaveBeenCalledTimes(1), { interval: 1 });
    const { conditional } = state.passkey.mock.calls[0]![0] as { conditional: AbortSignal };
    const input = host.querySelector<HTMLInputElement>("#email")!;

    input.value = "p";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();

    expect(conditional.aborted).toBe(true);
  });

  it("stays quiet when the inline passkey sheet is dismissed", async () => {
    stubConditionalPasskey();
    const ceremony = deferred<PasskeyResult>();
    state.passkey.mockReturnValue(ceremony.promise);
    const host = mount();

    await vi.waitFor(() => expect(state.passkey).toHaveBeenCalledTimes(1), { interval: 1 });
    ceremony.resolve({ error: { tag: "PasskeyNotAllowed", message: "raw detail" } });
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

    await vi.waitFor(() => expect(state.startSso).toHaveBeenCalledTimes(1), { interval: 1 });
    // The account preview appears only once the lookup has settled.
    await vi.waitFor(() => expect(host.textContent).toContain("person@example.com"), {
      interval: 1,
    });
    flush();

    expect(state.passkey).not.toHaveBeenCalled();
    expect(button(host, /sign in with a passkey/i)).toBeDefined();
  });
});
