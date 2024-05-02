import { match } from "ts-pattern";
import type { PolicyData } from "./policy";

// TODO: Maybe render as categories instead instead of just each element?

export function formatPolicy(data: PolicyData) {
	const result: string[] = [];

	for (const [k, v] of Object.entries(data?.windows || {})) {
		result.push("Windows");
	}

	if (data?.macos) {
		result.push("macOS");
	}

	// TODO: Android

	for (const entry of data?.scripts || []) {
		result.push(`Script ${entry.shell}`);
	}

	return result;
}
