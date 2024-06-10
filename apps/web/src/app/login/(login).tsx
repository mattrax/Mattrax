import { Button, CardDescription } from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { Show, createMemo, createSignal, startTransition } from "solid-js";
import { z } from "zod";

import { useQueryClient } from "@tanstack/solid-query";
import { resetMattraxCache } from "~/cache";
import { trpc } from "~/lib";
import { parseJson } from "~/lib/utils";

export default function Page() {
	const navigate = useNavigate();
	const location = useLocation<{ continueTo?: string }>();

	// TODO: preload `/login/code`

	const queryClient = useQueryClient();
	const login = trpc.auth.sendLoginCode.createMutation(() => ({
		onSuccess: async (_, { email }) => {
			queryClient.clear();
			await resetMattraxCache();
			// revalidate(); // TODO: Wipe entire Solid cache (I can't see a method for it)

			await startTransition(() =>
				navigate(
					`/login/code${
						location.query?.action ? `?action=${location.query.action}` : ""
					}`,
					{
						// Pop the reauthenticate process from the history stack
						// replace: location.state?.continueTo !== undefined, // TODO: Finish this
						state: { email, ...location.state },
					},
				),
			);
		},
	}));

	const [lastSubmittedEmail, setLastSubmittedEmail] = createSignal<
		string | undefined
	>();
	const form = createZodForm({
		schema: z.object({ email: z.string() }),
		onSubmit: ({ value }) => {
			setLastSubmittedEmail(value.email);
			login.mutateAsync(value);
		},
	});

	const jsonError = createMemo(() => parseJson(login.error?.shape?.message));

	return (
		<>
			<CardDescription>Sign in with your email to get started</CardDescription>

			<Form form={form} class="pt-4 w-full max-w-80" fieldsetClass="space-y-2">
				<Show when={jsonError()?.code === "USER_IS_IN_MANAGED_TENANT"}>
					<p class="text-red-500 text-sm text-center">
						Your domain is under management by <b>{jsonError()?.tenantName}</b>.
						You might want the{" "}
						<A href="/enroll" target="_self" class="underline">
							enroll page
						</A>{" "}
						if not{" "}
						<button
							type="button"
							disabled={!lastSubmittedEmail()}
							onClick={() =>
								login.mutateAsync({
									email: lastSubmittedEmail()!,
									addIfManaged: true,
								})
							}
							class="underline"
						>
							continue
						</button>
						.
					</p>
				</Show>

				<InputField
					form={form}
					type="email"
					name="email"
					placeholder="Email"
					autocomplete="email"
				/>

				<Button type="submit" class="w-full">
					<span class="text-sm font-semibold leading-6">
						{login.isPending ? "Submitting" : "Continue"}
					</span>
				</Button>
				<p class="text-center text-sm text-gray-500">
					If your not an administrator,{" "}
					<A href="/enroll" target="_self" class="underline">
						enroll your device
					</A>
				</p>
			</Form>
		</>
	);
}
