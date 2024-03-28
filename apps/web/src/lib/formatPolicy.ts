import { match } from "ts-pattern";
import type { Configuration } from "./policy";

// TODO: Maybe render as categories instead instead of just each element?

export function formatPolicy(configuration: Configuration) {
	return match(configuration.type)
		.with("script", () => `${true ? "Bash" : "Powershell"} Script`) // TODO: Properly render script type
		.with("windows", () => "Windows") // TODO: Make this render more specific
		.exhaustive();
}
