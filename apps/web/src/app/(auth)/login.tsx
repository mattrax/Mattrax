import {
	Match,
	Switch,
	createSignal,
	onMount,
	startTransition,
} from "solid-js";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { Button, Card, CardContent, CardHeader } from "@mattrax/ui";
import { revalidate, useNavigate, useSearchParams } from "@solidjs/router";
import { z } from "zod";

import { trpc } from "~/lib";
import { OTPInput, preloadOTPInput } from "~/components/OTPInput";
import { useQueryClient } from "@tanstack/solid-query";
import { resetMattraxCache } from "~/cache";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";

// TODO: Use Mattrax colors on this page

export default function Page() {
	const [state, setState] = createSignal<
		{ variant: "sendCode" } | { variant: "verifyCode"; email: string }
	>({ variant: "sendCode" });

	const [searchParams] = useSearchParams<{ continueTo?: string }>();

	// We load this in the background on the email input page.
	onMount(() => preloadOTPInput());

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
					<h1 class="text-red-500 text-center">
						WARNING: NOT READY FOR PUBLIC USE, AND COMES WITH NO WARRANTY OR
						SECURITY GUARANTEES
					</h1>
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
								const queryClient = useQueryClient();
								const login = trpc.auth.sendLoginCode.createMutation(() => ({
									onSuccess: async (_, { email }) => {
										queryClient.clear();
										await resetMattraxCache();
										// revalidate(); // TODO: Wipe entire Solid cache (I can't see a method for it)

										await startTransition(() =>
											setState({ variant: "verifyCode", email }),
										);
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

								const me = trpc.auth.me.createQuery(undefined, () => ({
									enabled: false,
								}));
								const orgs = trpc.org.list.createQuery(undefined, () => ({
									enabled: false,
								}));

								const verify = trpc.auth.verifyLoginCode.createMutation(() => ({
									onSuccess: () => {
										let to: string;

										if (
											searchParams.continueTo &&
											URL.canParse(
												`${window.location.origin}${searchParams.continueTo}`,
											)
										)
											to = searchParams.continueTo;
										else to = "/";

										return startTransition(() => navigate(to));
									},
									...withDependantQueries([me, orgs]),
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

										<div class="flex justify-center">
											<OTPInput
												name="code"
												disabled={form.state.isSubmitting}
												onInput={(value) => {
													form.setFieldValue("code", value);
													if (value.length === 8) form.handleSubmit();
												}}
												onKeyDown={(e) => {
													if (e.key === "Enter") form.handleSubmit();
												}}
											/>
										</div>

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
