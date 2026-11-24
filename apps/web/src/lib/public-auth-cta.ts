/**
 * The primary action on the public marketing pages.
 *
 * Session state can be unknown during the first client pass, so `undefined`
 * means "render a neutral skeleton": never show Start free to someone who is
 * signed in, or Open dashboard to someone who is signed out. The landing page
 * adds a <noscript> Start free link for clients that never run JavaScript.
 */
export type PublicPrimaryCta = {
  readonly label: "Start free" | "Open dashboard";
  readonly href: "/register" | "/dashboard";
};

export const publicPrimaryCta = (
  pending: boolean,
  signedIn: boolean,
): PublicPrimaryCta | undefined => {
  if (pending) return undefined;

  return signedIn
    ? { label: "Open dashboard", href: "/dashboard" }
    : { label: "Start free", href: "/register" };
};
