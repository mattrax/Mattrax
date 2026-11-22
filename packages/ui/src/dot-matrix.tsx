import type { ComponentProps } from "@solidjs/web";
import { cn } from "./lib/cn";
import { splitProps } from "./lib/solid";

export type DotMatrixPattern = "wave" | "spiral" | "rain" | "ripple" | "snake" | "scan";
export type DotMatrixState = "loading" | "success" | "error";

const COLS = 6;
const ROWS = 5;

/** Cells of a check and a cross, drawn on the same dot field as the loader. */
const CHECK = new Set(["1:0", "2:1", "3:2", "2:3", "1:4", "0:5"]);
const CROSS = new Set(["0:0", "1:1", "2:2", "3:3", "4:4", "0:5", "1:4", "2:3", "3:2", "4:1"]);

const key = (row: number, col: number) => `${row}:${col}`;

/**
 * Each pattern is the same pulse with a different delay per dot. Keeping the
 * geometry in CSS and only the delay here means a pattern costs one number per
 * dot instead of its own animation.
 */
const delayFor = (pattern: DotMatrixPattern, row: number, col: number): number => {
  switch (pattern) {
    case "wave":
      return col * 0.09 + row * 0.025;
    case "spiral": {
      const centreRow = (ROWS - 1) / 2;
      const centreCol = (COLS - 1) / 2;
      const radius = Math.max(Math.abs(row - centreRow), Math.abs(col - centreCol));
      const angle = Math.atan2(row - centreRow, col - centreCol);

      return radius * 0.2 + ((angle + Math.PI) / (Math.PI * 2)) * 0.14;
    }
    case "rain":
      return row * 0.11 + col * 0.035;
    case "ripple": {
      const centreRow = (ROWS - 1) / 2;
      const centreCol = (COLS - 1) / 2;

      return Math.hypot((col - centreCol) * 0.72, row - centreRow) * 0.1;
    }
    case "snake":
      return (row * COLS + (row % 2 === 0 ? col : COLS - 1 - col)) * 0.025;
    case "scan":
      return col * 0.13 + Math.abs(row - (ROWS - 1) / 2) * 0.02;
  }
};

const fillRank = (row: number, col: number) => row * COLS + (row % 2 === 0 ? col : COLS - 1 - col);

export type DotMatrixProps = Omit<ComponentProps<"span">, "children"> & {
  pattern?: DotMatrixPattern;
  state?: DotMatrixState;
  /** Percentage, 0–100. Turns the loader into a determinate fill. */
  value?: number;
  /** Width in pixels; the field keeps its 6:5 aspect ratio. */
  size?: number;
  label?: string;
  /** Drop the live-region semantics when a parent already announces the state. */
  decorative?: boolean;
  class?: string;
};

/**
 * A compact dot-matrix activity mark: one dot field that can wave, spiral,
 * rain, ripple, snake or scan while loading, fill determinately, and settle
 * into a check or a cross. The drawing is decoration; the live region lives on
 * the root unless `decorative` is set.
 */
function DotMatrix(props: DotMatrixProps) {
  const [local, others] = splitProps(props, [
    "pattern",
    "state",
    "value",
    "size",
    "label",
    "decorative",
    "class",
  ]);

  const pattern = () => local.pattern ?? "wave";
  const state = () => local.state ?? "loading";
  const determinate = () => state() === "loading" && local.value !== undefined;
  const percent = () => Math.min(100, Math.max(0, local.value ?? 0));
  const litCount = () => Math.round((percent() / 100) * COLS * ROWS);
  const shape = () => (state() === "success" ? CHECK : state() === "error" ? CROSS : undefined);

  const lit = (row: number, col: number) => {
    if (shape()) return shape()!.has(key(row, col));
    if (determinate()) return fillRank(row, col) < litCount();

    return true;
  };

  const tone = (row: number, col: number) => {
    if (!lit(row, col)) return "bg-border";
    if (state() === "success") return "bg-success";
    if (state() === "error") return "bg-destructive";

    return determinate() ? "bg-info" : "bg-brand-solid";
  };

  const dotClass = (row: number, col: number) =>
    cn(
      "justify-self-center self-center rounded-full transition-[background-color,opacity] duration-[var(--duration-hover)] ease-swift",
      tone(row, col),
      lit(row, col) ? "opacity-100" : "opacity-30",
    );

  const width = () => local.size ?? 24;

  const dots = Array.from({ length: COLS * ROWS }, (_, index) => ({
    row: Math.floor(index / COLS),
    col: index % COLS,
  }));

  return (
    <span
      data-slot="dot-matrix"
      data-state={state()}
      data-value={determinate() ? Math.round(percent()) : undefined}
      role={local.decorative ? undefined : determinate() ? "progressbar" : "status"}
      aria-label={
        local.decorative
          ? undefined
          : (local.label ??
            (state() === "success" ? "Done" : state() === "error" ? "Failed" : "Loading"))
      }
      aria-valuemin={!local.decorative && determinate() ? 0 : undefined}
      aria-valuemax={!local.decorative && determinate() ? 100 : undefined}
      aria-valuenow={!local.decorative && determinate() ? Math.round(percent()) : undefined}
      aria-hidden={local.decorative ? "true" : undefined}
      class={cn("inline-grid shrink-0 place-items-center", local.class)}
      style={{
        "grid-template-columns": `repeat(${COLS}, 1fr)`,
        "grid-template-rows": `repeat(${ROWS}, 1fr)`,
        width: `${width()}px`,
        height: `${(width() * ROWS) / COLS}px`,
      }}
      {...others}
    >
      {dots.map(({ row, col }) => (
        <span
          data-slot="dot-matrix-dot"
          data-animated={state() === "loading" && !determinate() ? "true" : "false"}
          data-enter={state() === "loading" ? "false" : "true"}
          class={dotClass(row, col)}
          style={{
            width: "58%",
            "aspect-ratio": "1",
            "animation-delay": `${delayFor(pattern(), row, col)}s`,
          }}
        />
      ))}
    </span>
  );
}

export { DotMatrix };
