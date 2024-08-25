// @refresh reload
import { StartClient, mount } from "@solidjs/start/client";

const prefersColorSchema = window.matchMedia?.("(prefers-color-scheme: dark)");
const computeTheme = () => {
	let theme = localStorage.getItem("theme");
	if (!theme) theme = prefersColorSchema?.matches === true ? "dark" : "light";
	if (theme === "dark") {
		document.body.classList.add("dark");
	} else {
		document.body.classList.remove("dark");
	}
};
computeTheme();
prefersColorSchema?.addEventListener("change", () => computeTheme());

mount(() => <StartClient />, document.getElementById("app")!);
