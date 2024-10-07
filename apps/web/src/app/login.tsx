import OtpField from "@corvu/otp-field";
import { Button, CardDescription } from "@mattrax/ui";
import { Form, InputField, createForm } from "@mattrax/ui/forms";
import { autofocus } from "@solid-primitives/autofocus";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { type Setter, Show, createSignal, startTransition } from "solid-js";
import { z } from "zod";
import { ModalPage } from "~/components/ModalPage";

import { useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { trpc } from "~/lib";
import { doLogin } from "~/lib/data";

// Don't bundle split this Solid directive
autofocus;

export default function () {
	const [email, setEmail] = createSignal<string | undefined>(undefined);

	return (
		<ModalPage>
			<Show when={email()} fallback={<EmailPage setEmail={setEmail} />}>
				{(email) => <CodePage email={email()} setEmail={setEmail} />}
			</Show>
		</ModalPage>
	);
}

function EmailPage(props: { setEmail: Setter<string | undefined> }) {
	const login = trpc.auth.sendLoginCode.createMutation(() => ({
		onSuccess: (_, { email }) => startTransition(() => props.setEmail(email)),
		onError: () =>
			// TODO: Form error, not a toast
			toast.error("An internal error occurred!", {
				description: "Please try again!",
			}),
	}));

	const form = createForm({
		schema: () => z.object({ email: z.string() }),
		onSubmit: (value) => login.mutateAsync(value),
	});

	return (
		<div class="flex flex-col items-center">
			<CardDescription class="text-center">
				Log in to use Mattrax
			</CardDescription>

			<Form form={form} class="pt-4 w-full max-w-80" fieldsetClass="space-y-2">
				<InputField
					form={form}
					type="email"
					name="email"
					placeholder="Email"
					autocomplete="email"
				/>

				<Button type="submit" class="w-full">
					<span class="text-sm font-semibold leading-6">
						{login.isPending ? "Submitting" : "Continue with email"}
					</span>
				</Button>

				{/* <p class="text-center text-sm text-gray-500">
					If your not an administrator,{" "}
					<A href="/enroll" target="_self" class="underline">
						enroll your device
					</A>
				</p> */}
			</Form>
		</div>
	);
}

function CodePage(props: {
	email: string;
	setEmail: Setter<string | undefined>;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [query] = useSearchParams<{ next?: string }>();

	const verify = trpc.auth.verifyLoginCode.createMutation(() => ({
		onSuccess: async (user) => {
			let to: string;

			if (query?.next && URL.canParse(`${window.location.origin}${query.next}`))
				to = query.next;
			else to = "/";

			queryClient.clear();
			doLogin(user);

			await startTransition(() =>
				navigate(to, {
					replace: true,
				}),
			);
		},
		onError: (err) => {
			// TODO: Make it let you send another code to the same email cause this will be infuriating.
			toast.error(err.message, {
				description: "Please try again!",
			});
			props.setEmail(undefined);
		},
	}));

	const form = createForm({
		schema: () => z.object({ code: z.string() }),
		onSubmit: (value) => verify.mutateAsync(value),
	});

	return (
		<div class="flex flex-col items-center">
			<CardDescription class="text-center max-w-80">
				Check the inbox of <b>{props.email}</b> to get the code we sent you
			</CardDescription>

			<Form form={form} class="pt-4" fieldsetClass="space-y-2">
				<OtpField
					maxLength={8}
					class="flex"
					onValueChange={(value) => (form.fields.code.value = value)}
					onComplete={(v) => {
						// When pasting `onValueChange` doesn't fire so we must handle it here.
						form.fields.code.value = v;
						// When pasting `onComplete` double fires
						if (!form.isSubmitting) form.onSubmit();
					}}
					ref={(el) => el.focus()}
				>
					<OtpField.Input
						aria-label="Verification Code"
						class="opacity-0"
						name="code"
						disabled={form.isSubmitting}
						use:autofocus
						autofocus
					/>
					<div class="flex items-center space-x-2">
						<OTPSlot index={0} disabled={form.isSubmitting} />
						<OTPSlot index={1} disabled={form.isSubmitting} />
						<OTPSlot index={2} disabled={form.isSubmitting} />
						<OTPSlot index={3} disabled={form.isSubmitting} />
					</div>
					<div class="flex size-10 items-center justify-center font-bold">
						-
					</div>
					<div class="flex items-center space-x-2">
						<OTPSlot index={4} disabled={form.isSubmitting} />
						<OTPSlot index={5} disabled={form.isSubmitting} />
						<OTPSlot index={6} disabled={form.isSubmitting} />
						<OTPSlot index={7} disabled={form.isSubmitting} />
					</div>
				</OtpField>
			</Form>
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
			class="flex size-10 items-center justify-center rounded-md bg-slate-100 font-mono text-sm font-bold transition-all ring-blue-700/10 ring-2"
			classList={{
				"ring-corvu-text ring-2": context.activeSlots().includes(props.index),
			}}
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
