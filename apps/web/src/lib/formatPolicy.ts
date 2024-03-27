import { match } from "ts-pattern";
import type { Configuration } from "./policy";

// TODO: Maybe render as categories instead instead of just each element?

export function formatPolicy(configuration: Configuration) {
	return match(configuration.type)
		.with("script", () => `${true ? "Bash" : "Powershell"} Script`) // TODO: Properly render script type
		.with("apple_custom", () => "Apple Custom") // TODO: Render OMA URI's
		.with("windows_custom", () => "Windows Custom") // TODO: Render OMA URI's
		.exhaustive();
}
