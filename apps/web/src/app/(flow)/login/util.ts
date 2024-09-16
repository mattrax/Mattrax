import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { startTransition } from "solid-js";

export function createLoginOnSuccess() {
	const [query] = useSearchParams<{ next?: string }>();
	const location = useLocation<{
		email?: string;
		action?: string;
	}>();

	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return async () => {
		let to: string;

		if (query?.next && URL.canParse(`${window.location.origin}${query.next}`))
			to = query.next;
		else to = "/";

		queryClient.clear();
		// await resetMattraxCache();

		await startTransition(() =>
			navigate(to, {
				state: {
					action: location.state?.action,
				},
				// Ensures the history stack is `/login` then `/users-page`
				replace: true,
			}),
		);
	};
}
