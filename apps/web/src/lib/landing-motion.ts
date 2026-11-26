/**
 * Landing motion primitives.
 *
 * Every helper is an enhancement over a complete server-rendered document:
 *
 * - nothing runs during SSR, and nothing runs when the visitor asks for
 *   reduced motion, so the static page is always the fallback;
 * - hiding is expressed only through CSS which is gated on `html.js` and
 *   `prefers-reduced-motion: no-preference`, never through inline styles;
 * - scroll work is one passive listener feeding one requestAnimationFrame
 *   loop, and geometry is measured on mount/resize rather than while
 *   scrolling;
 * - `onCleanup` removes observers, listeners and timers when the route is
 *   disposed.
 *
 * The CSS that reads these values lives in `src/landing.css`.
 */
import { isServer } from "@solidjs/web";
import { onCleanup } from "solid-js";

const REVEAL_SELECTOR = '[data-reveal="pending"]';

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const REVEAL_FAILSAFE_MS = 3_000;

/** True when the browser is past first paint and motion is welcome. */
function motionAllowed(): boolean {
  if (isServer) return false;

  return !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Run `attach` once the component tree is in the DOM, with lifecycle cleanup.
 *
 * Deliberately not `onSettled`: settling registers a context id during the
 * render pass, which shifts the hydration keys of everything the component
 * renders afterwards. The landing page is server-rendered and hydrated, so a
 * frame later is the safe point to measure and observe.
 */
function afterSettle(attach: () => (() => void) | undefined): void {
  if (!motionAllowed()) return;

  let cleanup: (() => void) | undefined;
  let disposed = false;
  let frame = 0;
  let attempts = 0;

  // A subtree can still be detached for a frame while the router streams it
  // in, so wait for the page root before measuring or observing.
  const run = () => {
    frame = 0;

    if (disposed) return;

    if (!landingRoot()) {
      if (attempts++ < 120) frame = window.requestAnimationFrame(run);

      return;
    }

    cleanup = attach();
  };

  onCleanup(() => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    cleanup?.();
    cleanup = undefined;
  });

  frame = window.requestAnimationFrame(run);
}

function landingRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".lx-page");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/* -------------------------------------------------------------------------
 * One scroll loop for the whole page
 * ---------------------------------------------------------------------- */

type ScrollListener = () => void;

const scrollListeners = new Set<ScrollListener>();

let scrollFrame = 0;

function flushScroll(): void {
  scrollFrame = 0;

  for (const listener of scrollListeners) listener();
}

function requestScrollFlush(): void {
  if (scrollFrame !== 0) return;

  scrollFrame = window.requestAnimationFrame(flushScroll);
}

function subscribeScroll(listener: ScrollListener): () => void {
  scrollListeners.add(listener);

  if (scrollListeners.size === 1) {
    window.addEventListener("scroll", requestScrollFlush, { passive: true });
  }

  return () => {
    scrollListeners.delete(listener);

    if (scrollListeners.size > 0) return;

    window.removeEventListener("scroll", requestScrollFlush);

    if (scrollFrame === 0) return;

    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  };
}

/**
 * Map a section's scroll progress (0..1) to a callback.
 *
 * `travel` is cached on mount and resize, so a frame costs one subtraction and
 * a clamp. The section is the scroll track: p=0 when its top reaches the
 * viewport top, p=1 after `height - innerHeight`.
 */
function bindProgress(section: HTMLElement, report: (progress: number) => void): () => void {
  let top = 0;
  let travel = 0;

  const measure = () => {
    top = section.getBoundingClientRect().top + window.scrollY;
    travel = Math.max(0, section.offsetHeight - window.innerHeight);
  };

  const update = () => {
    if (travel <= 0) {
      report(0);

      return;
    }

    report(clamp01((window.scrollY - top) / travel));
  };

  const onResize = () => {
    measure();
    update();
  };

  const unsubscribe = subscribeScroll(update);
  const resizeObserver = new ResizeObserver(onResize);

  resizeObserver.observe(section);
  window.addEventListener("resize", onResize, { passive: true });
  measure();
  update();

  return () => {
    unsubscribe();
    resizeObserver.disconnect();
    window.removeEventListener("resize", onResize);
  };
}

/* -------------------------------------------------------------------------
 * Reveal once
 * ---------------------------------------------------------------------- */

let revealObserver: IntersectionObserver | undefined;

let revealTimer: number | undefined;

let revealsInstalled = false;

let observerFired = false;

const counted = new WeakSet<Element>();

function countUp(element: HTMLElement): void {
  if (counted.has(element)) return;

  counted.add(element);

  const target = Number(element.dataset.count);

  if (!Number.isFinite(target)) return;

  const startedAt = performance.now();

  const tick = (now: number) => {
    if (!element.isConnected) return;

    const elapsed = clamp01((now - startedAt) / 640);
    const eased = 1 - (1 - elapsed) ** 3;

    element.textContent = String(Math.round(target * eased));

    if (elapsed < 1) window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
}

function reveal(element: Element): void {
  if (element.getAttribute("data-reveal") !== "pending") return;

  element.setAttribute("data-reveal", "in");
  revealObserver?.unobserve(element);

  for (const counter of element.querySelectorAll<HTMLElement>("[data-count]")) countUp(counter);
}

/**
 * Observe every `[data-reveal="pending"]` once with a single shared observer.
 *
 * The three-second failsafe reveals everything if the observer never delivers
 * its first callback, so content cannot stay hidden because motion failed.
 * Off-screen sections are left to the observer, which keeps the reveal for the
 * moment they enter the viewport.
 */
export function installReveals(): void {
  afterSettle(() => {
    const root = landingRoot();

    if (!root || revealsInstalled) return;

    revealsInstalled = true;

    if (!("IntersectionObserver" in window)) {
      for (const element of root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR)) {
        element.setAttribute("data-reveal", "in");
      }

      return () => {
        revealsInstalled = false;
      };
    }

    revealObserver = new IntersectionObserver(
      (entries) => {
        // The initial callback fires even when nothing intersects, so this
        // proves the observer works without revealing off-screen sections.
        observerFired = true;

        for (const entry of entries) {
          if (entry.isIntersecting) reveal(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    for (const element of root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR)) {
      revealObserver.observe(element);
    }

    revealTimer = window.setTimeout(() => {
      if (observerFired) return;

      for (const element of root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR)) reveal(element);
    }, REVEAL_FAILSAFE_MS);

    return () => {
      revealsInstalled = false;
      observerFired = false;
      revealObserver?.disconnect();
      revealObserver = undefined;

      if (revealTimer !== undefined) window.clearTimeout(revealTimer);

      revealTimer = undefined;
    };
  });
}

/* -------------------------------------------------------------------------
 * Hero aperture
 * ---------------------------------------------------------------------- */

const heroBindings = new WeakSet<Element>();

/** Write the hero's scroll progress as `--p`, and its activity as `data-p`. */
export function installHeroProgress(): void {
  afterSettle(() => {
    const root = landingRoot();
    const hero = root?.querySelector<HTMLElement>(".lx-hero");

    if (!hero || heroBindings.has(hero)) return;

    heroBindings.add(hero);

    let start = 0;

    const measure = () => {
      start = hero.getBoundingClientRect().top + window.scrollY;
    };

    // The hero is not pinned: the copy scrolls with the page while the console
    // opens, so the aperture finishes over roughly a third of a screen.
    const update = () => {
      const travel = Math.max(180, Math.min(window.innerHeight * 0.36, 380));
      const progress = clamp01((window.scrollY - start) / travel);

      hero.style.setProperty("--p", progress.toFixed(4));
      hero.dataset.p = progress > 0.001 && progress < 0.999 ? "active" : "idle";
    };

    const onResize = () => {
      measure();
      update();
    };

    const unsubscribe = subscribeScroll(update);

    window.addEventListener("resize", onResize, { passive: true });
    measure();
    update();

    return () => {
      heroBindings.delete(hero);
      unsubscribe();
      window.removeEventListener("resize", onResize);
    };
  });
}

/* -------------------------------------------------------------------------
 * Sticky product story
 * ---------------------------------------------------------------------- */

const storyBindings = new WeakSet<Element>();

function stepFor(progress: number): number {
  return Math.min(2, Math.max(0, Math.floor(progress * 3)));
}

/** Track the sticky story's thirds and publish them as `data-step`. */
export function installStorySteps(): void {
  afterSettle(() => {
    const root = landingRoot();
    const story = root?.querySelector<HTMLElement>(".lx-story");

    if (!story || storyBindings.has(story)) return;

    storyBindings.add(story);

    const cleanup = bindProgress(story, (progress) => {
      const step = String(stepFor(progress));

      if (story.dataset.step === step) return;

      story.dataset.step = step;
    });

    return () => {
      storyBindings.delete(story);
      cleanup();
    };
  });
}

/* -------------------------------------------------------------------------
 * Hold to confirm
 * ---------------------------------------------------------------------- */

export type HoldProgressOptions = {
  /** Resolved after mount; refs are not assigned when the component body runs. */
  readonly button: () => HTMLButtonElement | undefined;
  readonly ring: () => SVGCircleElement | null | undefined;
  readonly durationMs: number;
  readonly onCommit: () => void;
};

const holdBindings = new WeakSet<Element>();

/**
 * Fill a ring while a destructive button is held, then commit once.
 *
 * The gesture is pointer-only. Keyboard users activate the same button with
 * Enter/Space, which the component turns into a two-step confirmation. The
 * helper does nothing under reduced motion so the static document keeps the
 * ordinary button behaviour.
 */
export function installHoldProgress(options: HoldProgressOptions): void {
  afterSettle(() => {
    const button = options.button();

    if (!button || holdBindings.has(button)) return;

    holdBindings.add(button);

    const ring = options.ring();
    const radius = ring?.r.baseVal.value ?? 9;
    const circumference = 2 * Math.PI * radius;
    let frame = 0;
    let startedAt = 0;
    let holding = false;

    const paint = (value: number) => {
      if (!ring) return;

      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - value));
    };

    const stop = () => {
      holding = false;
      startedAt = 0;
      window.removeEventListener("keydown", cancelFromKeyboard, true);

      if (frame !== 0) window.cancelAnimationFrame(frame);

      frame = 0;
      delete button.dataset.holding;
      paint(0);
    };

    const tick = (now: number) => {
      if (!holding) return;

      if (startedAt === 0) startedAt = now;

      const value = clamp01((now - startedAt) / options.durationMs);

      paint(value);

      if (value < 1) {
        frame = window.requestAnimationFrame(tick);

        return;
      }

      stop();
      options.onCommit();
    };

    const start = (event: PointerEvent) => {
      if (event.button !== 0 || holding) return;

      holding = true;
      button.dataset.holding = "";
      button.setPointerCapture(event.pointerId);
      window.addEventListener("keydown", cancelFromKeyboard, true);
      paint(0);
      frame = window.requestAnimationFrame(tick);
    };

    const cancel = () => {
      if (!holding) return;

      stop();
    };

    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      cancel();
    };

    paint(0);
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("blur", cancel);

    return () => {
      holdBindings.delete(button);
      stop();
      button.removeEventListener("pointerdown", start);
      button.removeEventListener("pointerup", cancel);
      button.removeEventListener("pointerleave", cancel);
      button.removeEventListener("pointercancel", cancel);
      button.removeEventListener("blur", cancel);
    };
  });
}
