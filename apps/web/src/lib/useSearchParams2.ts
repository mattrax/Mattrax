import { useLocation, useNavigate } from "@solidjs/router";
import { batch, createComputed, createEffect } from "solid-js";
import { createMutable } from "solid-js/store";

// A clone of `useSearchParams` that can handle multiple values for the same key
export function useSearchParams2() {
	const location = useLocation();
	const navigate = useNavigate();
	const params = createMutable<Record<string, string[] | undefined>>({});

	createComputed(() =>
		batch(() => {
			const q = new URLSearchParams(location.search);
			for (const k of q.keys()) params[k] = q.getAll(k);
		}),
	);

	createEffect(() => {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (v?.length === 0) {
				params[k] = undefined;
				continue;
			}
			if (v)
				v.forEach((v) => {
					if (v !== "") q.append(k, v);
				});
		}
		let s = q.toString();
		if (s !== "") s = `?${s}`;
		navigate(s, { replace: true });
	});

	return params;
}
