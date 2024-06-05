import { Button, CardDescription } from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import {
	Match,
	Show,
	Switch,
	createSignal,
	onMount,
	startTransition,
} from "solid-js";
import { z } from "zod";

import OtpField from "@corvu/otp-field";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { autofocus } from "@solid-primitives/autofocus";
import { useQueryClient } from "@tanstack/solid-query";
import clsx from "clsx";
import { resetMattraxCache } from "~/cache";
import { trpc } from "~/lib";
import { parseJson } from "~/lib/utils";

// Don't bundle split this Solid directive
autofocus;

// TODO: Use Mattrax colors on this page

export default function Page() {
	const [state, setState] = createSignal<
		{ variant: "sendCode" } | { variant: "verifyCode"; email: string }
	>({ variant: "sendCode" });

	const [searchParams] = useSearchParams<{ continueTo?: string }>();

	return (
		<div class="flex-grow flex justify-center items-center">
			<div class="w-full flex flex-col items-center justify-center">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
					<span class="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
						Alpha
					</span>
				</div>

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

							return (
								<>
									<CardDescription>
										Sign in with your email to get started
									</CardDescription>

									<Form
										form={form}
										class="pt-4 w-full max-w-80"
										fieldsetClass="space-y-2"
									>
										<Show
											when={
												parseJson(login.error?.shape?.message)?.code ===
												"USER_IS_IN_MANAGED_TENANT"
											}
										>
											<p class="text-red-500 text-sm text-center">
												Your domain is under management by{" "}
												<b>
													{parseJson(login.error?.shape?.message)?.tenantName}
												</b>
												. You might want the{" "}
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
								<>
									<CardDescription class="text-center max-w-80">
										Check the inbox of <b>{state().email}</b> to get the code we
										sent you
									</CardDescription>

									<Form form={form} class="pt-4" fieldsetClass="space-y-2">
										<OtpField
											maxLength={8}
											class="flex"
											onValueChange={(value) =>
												form.setFieldValue("code", value)
											}
											onComplete={(e) => form.handleSubmit()}
											ref={(el) => {
												el.focus();
											}}
										>
											<OtpField.Input
												aria-label="Verification Code"
												class="opacity-0"
												name="code"
												disabled={form.state.isSubmitting}
												use:autofocus
												autofocus
											/>
											<div class="flex items-center space-x-2">
												<OTPSlot index={0} disabled={form.state.isSubmitting} />
												<OTPSlot index={1} disabled={form.state.isSubmitting} />
												<OTPSlot index={2} disabled={form.state.isSubmitting} />
												<OTPSlot index={3} disabled={form.state.isSubmitting} />
											</div>
											<div class="flex size-10 items-center justify-center font-bold">
												-
											</div>
											<div class="flex items-center space-x-2">
												<OTPSlot index={4} disabled={form.state.isSubmitting} />
												<OTPSlot index={5} disabled={form.state.isSubmitting} />
												<OTPSlot index={6} disabled={form.state.isSubmitting} />
												<OTPSlot index={7} disabled={form.state.isSubmitting} />
											</div>
										</OtpField>
									</Form>
								</>
							);
						}}
					</Match>
				</Switch>
			</div>
		</div>
	);
}

const OTPSlot = (props: { index: number; disabled?: boolean }) => {
	const context = OtpField.useContext();
	const char = () => context.value()[props.index];
	const showFakeCaret = () =>
		context.value().length === props.index && context.isInserting();

	return (
		<div
			class={clsx(
				"flex size-10 items-center justify-center rounded-md bg-slate-100 font-mono text-sm font-bold transition-all ring-blue-700/10 ring-2",
				{
					"ring-corvu-text ring-2": context.activeSlots().includes(props.index),
				},
			)}
		>
			<span
				classList={{
					"opacity-30": props.disabled,
				}}
			>
				{char()}
			</span>
			<Show when={showFakeCaret()}>
				<div class="pointer-events-none flex items-center justify-center">
					<div class="h-4 w-px animate-caret-blink bg-corvu-text duration-1000" />
				</div>
			</Show>
		</div>
	);
};
