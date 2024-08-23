import { makePersisted } from "@solid-primitives/storage";
import { createSignal } from "solid-js";

// TODO: Keeping these in sync across tabs??

export const [syncDisabled, setSyncDisabled] = makePersisted(
	createSignal(false),
	{ name: "disable-sync", storage: localStorage },
);

export const [showKdbShortcuts, setShowKdbShortcuts] = makePersisted(
	createSignal(false),
	{ name: "kdb-shortcuts", storage: localStorage },
);
