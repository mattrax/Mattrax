import { useNavigate } from "@solidjs/router";
import { Match, Switch, createSignal, startTransition } from "solid-js";
import { z } from "zod";

import { Form, InputField, createZodForm } from "~/components/forms";
import { Button, Card, CardContent, CardHeader } from "~/components/ui";
import { trpc } from "~/lib";

// TODO: Autocomplete attributes
// TODO: Use Mattrax colors on this page

export default function Page() {
	const [state, setState] = createSignal<
		{ variant: "sendCode" } | { variant: "verifyCode"; email: string }
	>({ variant: "sendCode" });

	return (
		<div class="h-full flex flex-row justify-center p-4">
			<Card class="max-w-md min-h-0 w-full self-center">
				<CardHeader>
					<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center">
						<h2 class="mt-4 text-center text-2xl font-bold leading-9 tracking-tight text-gray-900">
							Mattrax
						</h2>
						<span class="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
							Alpha
						</span>
					</div>
				</CardHeader>

				<CardContent>
					<Switch>
						<Match
							when={(() => {
								const s = state();
								if (s.variant === "sendCode") return s;
							})()}
						>
							{(_) => {
								const login = trpc.auth.sendLoginCode.useMutation(() => ({
									onSuccess: (_, { email }) => {
										setState({ variant: "verifyCode", email });
									},
								}));

								const form = createZodForm({
									schema: z.object({ email: z.string() }),
									onSubmit: ({ value }) => login.mutateAsync(value),
								});

								return (
									<Form form={form} fieldsetClass="space-y-2">
										<InputField
											form={form}
											type="email"
											name="email"
											placeholder="user@example.com"
											autocomplete="email"
										/>

										<Button type="submit" class="w-full">
											<span class="text-sm font-semibold leading-6">
												Send Login Code
											</span>
										</Button>
									</Form>
								);
							}}
						</Match>
						<Match
							when={(() => {
								const s = state();
								if (s.variant === "verifyCode") return s;
							})()}
						>
							{(state) => {
								const navigate = useNavigate();
								const verify = trpc.auth.verifyLoginCode.useMutation(() => ({
									onSuccess: () => startTransition(() => navigate("/")),
								}));

								const form = createZodForm({
									schema: z.object({ code: z.string() }),
									onSubmit: ({ value }) => verify.mutateAsync(value),
								});

								return (
									<Form form={form} fieldsetClass="space-y-2 text-center">
										<p>
											Enter the code sent to <b>{state().email}</b>
										</p>
										<InputField
											form={form}
											type="text"
											name="code"
											class="text-center font-mono"
											autocomplete="one-time-code"
											inputmode="numeric"
											maxlength="8"
											pattern="\d{8}"
										/>

										<Button type="submit" class="w-full">
											<span class="text-sm font-semibold leading-6">Login</span>
										</Button>
									</Form>
								);
							}}
						</Match>
					</Switch>
				</CardContent>
			</Card>
		</div>
	);
}
