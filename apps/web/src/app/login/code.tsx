import { CardDescription } from "@mattrax/ui";
import { Form, createZodForm } from "@mattrax/ui/forms";
import { useLocation, useNavigate } from "@solidjs/router";
import { Show, startTransition } from "solid-js";
import { z } from "zod";

import OtpField from "@corvu/otp-field";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { autofocus } from "@solid-primitives/autofocus";
import clsx from "clsx";
import { trpc } from "~/lib";

// Don't bundle split this Solid directive
autofocus;

export default function Page() {
	const location = useLocation<{ email?: string; continueTo?: string }>();
	const navigate = useNavigate();

	if (!location.state?.email) {
		startTransition(() => navigate("/login"));
		return;
	}

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
				location.state?.continueTo &&
				URL.canParse(`${window.location.origin}${location.state.continueTo}`)
			)
				to = location.state.continueTo;
			else
				to = `/${
					location.query?.action ? `?action=${location.query.action}` : ""
				}`;

			return navigate(to, {
				// Ensures the history stack is `/login` then `/users-page`
				replace: true,
			});
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
				Check the inbox of <b>{location.state.email}</b> to get the code we sent
				you
			</CardDescription>

			<Form form={form} class="pt-4" fieldsetClass="space-y-2">
				<OtpField
					maxLength={8}
					class="flex"
					onValueChange={(value) => form.setFieldValue("code", value)}
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
