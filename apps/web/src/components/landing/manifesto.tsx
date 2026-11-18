import { For } from "solid-js";
import { Eyebrow } from "./primitives";

const claimWords = ["Any", "MDM", "can", "send", "a", "profile."];

const qualifierWords = ["Few", "can", "tell", "you", "what", "happened", "next."];

const annotations = [
  "Which policy won — and why.",
  "Which device missed it — and when.",
  "Who changed it — and what they changed.",
];

export function Manifesto() {
  return (
    <section
      class="lx-section lx-section--ruled lx-manifesto"
      data-reveal="pending"
      aria-labelledby="manifesto-title"
    >
      <div class="lx-shell">
        <div class="lx-manifesto__grid">
          <div>
            <Eyebrow>The problem</Eyebrow>

            <h2 id="manifesto-title">
              <For each={claimWords}>
                {(word, index) => (
                  <>
                    <span class="lx-w" style={`--i:${Math.min(index(), 8)}`}>
                      {word}
                    </span>{" "}
                  </>
                )}
              </For>
              <span class="lx-muted">
                <For each={qualifierWords}>
                  {(word, index) => (
                    <>
                      <span
                        class="lx-w"
                        style={`--i:${Math.min(claimWords.length + index(), 8)}`}
                      >
                        {word}
                      </span>{" "}
                    </>
                  )}
                </For>
              </span>
            </h2>

            <p class="lx-manifesto__body">
              Policy conflicts. Devices that quietly stop checking in. An audit request six months
              after the change. A green tick is not an explanation. Mattrax makes the explanation
              part of the product: a policy resolution trace, a device timeline and an audit log you
              can export.
            </p>
          </div>

          <div>
            <ol class="lx-notes">
              <For each={annotations}>
                {(annotation, index) => (
                  <li style={`--i:${index()}`}>
                    <span class="lx-notes__rule" aria-hidden="true" />
                    {annotation}
                  </li>
                )}
              </For>
            </ol>
            <p class="lx-note lx-manifesto__after">The rest of this page is how.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
