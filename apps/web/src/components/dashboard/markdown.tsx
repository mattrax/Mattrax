import { Match } from "effect";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

const safeHref = (value: string) => {
  const url = value.trim();

  if (/^(https?:\/\/|mailto:|\/|#)/i.test(url)) return url;

  return null;
};

const safeImage = (value: string) => {
  const url = value.trim();

  if (/^(https?:\/\/|\/)/i.test(url)) return url;

  return null;
};

const INLINE =
  /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g;

const inline = (text: string): JSX.Element[] => {
  const nodes: JSX.Element[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;

    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];

    if (token.startsWith("![")) {
      const parts = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const src = parts ? safeImage(parts[2]!) : null;
      nodes.push(
        src ? (
          <img
            src={src}
            alt={parts?.[1] ?? ""}
            width={640}
            height={360}
            loading="lazy"
            class="my-2 h-auto max-h-56 w-auto max-w-full rounded-lg border border-white/[0.08] object-contain"
          />
        ) : (
          token
        ),
      );
    } else if (token.startsWith("[")) {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = parts ? safeHref(parts[2]!) : null;
      nodes.push(
        href ? (
          <a
            href={href}
            target={href.startsWith("/") || href.startsWith("#") ? undefined : "_blank"}
            rel={href.startsWith("/") || href.startsWith("#") ? undefined : "noreferrer"}
            class="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
          >
            {parts?.[1]}
          </a>
        ) : (
          token
        ),
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong class="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code class="rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em class="italic">{token.slice(1, -1)}</em>);
    }

    last = index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));

  return nodes;
};

/**
 * A deliberately small markdown subset. It creates real DOM nodes (never HTML
 * strings), so a team note cannot inject markup into the dashboard.
 */
export function Markdown(props: { content: string }) {
  const blocks = () => {
    const lines = props.content.replaceAll("\r\n", "\n").split("\n");
    const output: Array<() => JSX.Element> = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index]!;

      if (!line.trim()) {
        index++;
        continue;
      }

      if (line.startsWith("```")) {
        const body: string[] = [];
        index++;

        while (index < lines.length && !lines[index]!.startsWith("```")) {
          body.push(lines[index]!);
          index++;
        }

        index++;
        output.push(() => (
          <pre class="my-2 overflow-x-auto rounded-lg border border-white/[0.07] bg-black/30 p-3 text-[11.5px] leading-relaxed">
            <code class="font-mono">{body.join("\n")}</code>
          </pre>
        ));
        continue;
      }

      const heading = /^(#{1,4})\s+(.*)$/.exec(line);

      if (heading) {
        const level = heading[1]!.length;
        const content = inline(heading[2]!);
        output.push(() =>
          Match.value(level).pipe(
            Match.when(1, () => (
              <h2 class="mb-1.5 mt-3 text-[15px] font-semibold text-foreground first:mt-0">
                {content}
              </h2>
            )),
            Match.when(2, () => (
              <h3 class="mb-1.5 mt-3 text-[13.5px] font-semibold text-foreground first:mt-0">
                {content}
              </h3>
            )),
            Match.orElse(() => (
              <h4 class="mb-1 mt-2.5 text-[12.5px] font-semibold text-foreground first:mt-0">
                {content}
              </h4>
            )),
          ),
        );
        index++;
        continue;
      }

      if (/^([-*_])\1{2,}$/.test(line.trim())) {
        output.push(() => <hr class="my-3 border-white/[0.08]" />);
        index++;
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items: string[] = [];

        while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index]!)) {
          items.push(lines[index]!.replace(/^\s*[-*+]\s+/, ""));
          index++;
        }

        output.push(() => (
          <ul class="my-1.5 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
            <For each={items}>{(item) => <li>{inline(item)}</li>}</For>
          </ul>
        ));
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items: string[] = [];

        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index]!)) {
          items.push(lines[index]!.replace(/^\s*\d+\.\s+/, ""));
          index++;
        }

        output.push(() => (
          <ol class="my-1.5 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
            <For each={items}>{(item) => <li>{inline(item)}</li>}</For>
          </ol>
        ));
        continue;
      }

      if (line.startsWith("> ")) {
        const quoted: string[] = [];

        while (index < lines.length && lines[index]!.startsWith("> ")) {
          quoted.push(lines[index]!.slice(2));
          index++;
        }

        output.push(() => (
          <blockquote class="my-2 border-l-2 border-white/[0.12] pl-3 text-[12.5px] italic text-muted-foreground">
            {inline(quoted.join(" "))}
          </blockquote>
        ));
        continue;
      }

      const paragraph: string[] = [line];
      index++;

      while (
        index < lines.length &&
        lines[index]!.trim() &&
        !/^(#{1,4})\s|^\s*[-*+]\s+|^\s*\d+\.\s+|^```|^> /.test(lines[index]!)
      ) {
        paragraph.push(lines[index]!);
        index++;
      }

      output.push(() => (
        <p class="my-1.5 text-[12.5px] leading-relaxed text-muted-foreground first:mt-0 last:mb-0">
          {inline(paragraph.join(" "))}
        </p>
      ));
    }

    return output;
  };

  return (
    <div class="min-w-0">
      <Show
        when={props.content.trim()}
        fallback={<p class="text-[12px] text-muted-foreground">Nothing written yet.</p>}
      >
        <For each={blocks()}>{(block) => block()}</For>
      </Show>
    </div>
  );
}
