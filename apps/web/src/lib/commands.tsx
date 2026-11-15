import { createEffect, createSignal, onCleanup } from "solid-js";
import { isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";

/**
 * A command that can be run from Cmd+K. Page components use `useCommands` to
 * contribute scoped commands (and shortcuts) for as long as they are mounted.
 */
export type Command = {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly group: string;
  readonly icon?: (props: { class?: string }) => JSX.Element;
  /** Extra words that should match this command in the palette. */
  readonly keywords?: ReadonlyArray<string>;
  /** Navigable commands can be remembered as recents. */
  readonly href?: string;
  readonly shortcut?: CommandShortcut;
  /** A false result hides the shortcut and disables the command. */
  readonly enabled?: () => boolean;
  readonly run: () => void | Promise<void>;
};

export type CommandShortcut =
  | {
      readonly kind: "chord";
      readonly key: string;
      readonly mod?: boolean;
      readonly shift?: boolean;
      readonly alt?: boolean;
    }
  | {
      readonly kind: "sequence";
      readonly keys: ReadonlyArray<string>;
    };

export const chord = (
  key: string,
  options: { mod?: boolean; shift?: boolean; alt?: boolean } = {},
): CommandShortcut => ({ kind: "chord", key, ...options });

export const sequence = (...keys: string[]): CommandShortcut => ({ kind: "sequence", keys });

type StoredCommand = Command & { readonly owner: string };

const isCommandSource = (source: Command[] | (() => Command[])): source is () => Command[] =>
  typeof source === "function";

const [commands, setCommands] = createSignal<ReadonlyArray<StoredCommand>>([]);

/** Read-only view used by the command palette and global shortcut handler. */
export const registeredCommands = commands;

let nextOwner = 0;

/**
 * Register commands for the lifetime of the calling component. Effects keep
 * the registry in sync when the command list depends on reactive state.
 */
export function useCommands(source: Command[] | (() => Command[])) {
  if (isServer) return;
  const owner = `commands-${nextOwner++}`;
  createEffect(
    () => (isCommandSource(source) ? source() : source),
    (list) => {
      const owned: StoredCommand[] = list.map((command) => ({ ...command, owner }));
      setCommands((current) => [
        ...current.filter((command) => command.owner !== owner),
        ...owned,
      ]);
    },
  );
  onCleanup(() => {
    setCommands((current) => current.filter((command) => command.owner !== owner));
  });
}

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;

  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
};

export type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export const matchesChord = (shortcut: CommandShortcut, event: ShortcutEvent): boolean => {
  if (shortcut.kind !== "chord") return false;
  const mod = event.metaKey || event.ctrlKey;

  if (Boolean(shortcut.mod) !== mod) return false;

  if (Boolean(shortcut.shift) !== event.shiftKey) return false;

  if (Boolean(shortcut.alt) !== event.altKey) return false;

  return shortcut.key.toLowerCase() === event.key.toLowerCase();
};

const isMac = () =>
  typeof navigator !== "undefined" && /(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent);

/** Shortcut text for the palette, matching the platform's modifier symbols. */
export const shortcutLabel = (shortcut: CommandShortcut): string => {
  if (shortcut.kind === "sequence")
    return shortcut.keys.map((key) => key.toUpperCase()).join(" then ");
  const parts: string[] = [];

  if (shortcut.mod) parts.push(isMac() ? "⌘" : "Ctrl");

  if (shortcut.shift) parts.push(isMac() ? "⇧" : "Shift");

  if (shortcut.alt) parts.push(isMac() ? "⌥" : "Alt");
  parts.push(shortcut.key === " " ? "Space" : shortcut.key.toUpperCase());

  return parts.join("");
};
