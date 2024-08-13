import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
	Button,
	Kbd,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@mattrax/ui";
import {
	CheckboxField,
	Form,
	InputField,
	SelectField,
	createForm2,
	createZodForm,
	getFormError,
} from "@mattrax/ui/forms";
import { createConnectivitySignal } from "@solid-primitives/connectivity";
import { useNavigate } from "@solidjs/router";
import clsx from "clsx";
import { Show, createEffect, createSignal } from "solid-js";
import { z } from "zod";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";
import { getKey } from "~/lib/kv";
import { createDbQuery } from "~/lib/query";

export default function Page() {
	const ctx = createSearchPageContext([
		{
			type: "enum",
			target: "type",
			value: "users",
		},
	]);

	return (
		<PageLayout
			class="max-w-7xl space-y-2"
			heading={
				<>
					<PageLayoutHeading>Users</PageLayoutHeading>
					<Sheet open={true}>
						<SheetTrigger as={Button}>
							Create
							{/* // TODO: Add keyboard shortcut */}
							{/* <Kbd class="ml-2">N</Kbd> */}
						</SheetTrigger>
						<CreateUserSheetContent />
					</Sheet>
				</>
			}
		>
			<SearchPage {...ctx} showFilterBar={false} />
		</PageLayout>
	);
}

function CreateUserSheetContent() {
	const navigate = useNavigate();
	const isOnline = createConnectivitySignal();
	const org = createDbQuery((db) => getKey(db, "org"));

	// The form's `defaultValues` is tracked so it will likely re-run
	const defaultPassword = generateDefaultPassword();
	const [passwordVisible, setPasswordVisible] = createSignal(false);

	const form = createZodForm(() => ({
		schema: z.object({
			// TODO: Validate on all values
			name: z.string().min(2).max(256), // TODO: Make min 1
			upnLocal: z.string(), // TODO: .min(1).max(64),
			upnRemote: z.string(),
			mailNickname: z.string(), // TODO: .max(64),
			accountEnabled: z.boolean(),
			// TODO:  The new password must contain characters from at least 3 out of: Lowercase characters, Uppercase characters, Numbers, Symbols. The new password must not be weak or commonly used.
			// This field is not named *password* so browser don't ignore `autocomplete="off"` when they see `name="password"`
			// https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion#preventing_autofilling_with_autocompletenew-password
			password: z.string(), // TODO: .min(8).max(256),
		}),
		defaultValues: {
			name: "",
			upnLocal: "",
			upnRemote: org()?.verifiedDomains?.[0]?.name ?? "",
			mailNickname: "",
			accountEnabled: true,
			password: defaultPassword,
		},
		onSubmit: async ({ value }) => {
			// alert("TODO");
			await new Promise((r) => setTimeout(r, 3000));
			navigate("/"); // TODO
		},
	}));

	const form2 = createForm2({
		schema: z.object({
			// TODO: Validate on all values
			name: z.string().min(2).max(256), // TODO: Make min 1
			upnLocal: z.string(), // TODO: .min(1).max(64),
			upnRemote: z.string(),
			mailNickname: z.string(), // TODO: .max(64),
			accountEnabled: z.boolean(),
			// TODO:  The new password must contain characters from at least 3 out of: Lowercase characters, Uppercase characters, Numbers, Symbols. The new password must not be weak or commonly used.
			// This field is not named *password* so browser don't ignore `autocomplete="off"` when they see `name="password"`
			// https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion#preventing_autofilling_with_autocompletenew-password
			password: z.string(), // TODO: .min(8).max(256),
		}),
		defaultValues: () => ({
			name: "Hello",
		}),
	});
	createEffect(() => console.log(form2));

	const formErrors = form.useStore((state) => state.errors);
	const isValid = form.useStore((state) => state.isValid);
	const error = () => {
		if ((org()?.verifiedDomains.length ?? 0) === 0)
			// TODO: Link the user to the domain verification page
			return "Your organization must have a verified domain!";

		if (!isOnline()) return "You must be online to create a user!";

		// TODO: Remove this?
		const firstError = formErrors()[0];
		if (firstError) return firstError.toString();
	};

	// const todo = form.useStore((state) => state.values);
	// createEffect(() => console.log(isValid(), [...formErrors()], todo())); // TODO

	return (
		<SheetContent>
			<SheetHeader>
				<SheetTitle>Create user</SheetTitle>
				<SheetDescription>
					Create a new user in your organization.
				</SheetDescription>
			</SheetHeader>

			<Form
				form={form}
				class="py-4"
				fieldsetClass="flex flex-col space-y-4"
				autocomplete="off"
			>
				<InputField
					form={form}
					name="name"
					label="Name"
					placeholder="John Doe"
					autocomplete="off"
					onInput={(e) => {
						const value = e.target.value.split(" ")[0]?.toLowerCase() || "";
						if (form.getFieldMeta("upnLocal")?.isDirty !== true)
							form.setFieldValue("upnLocal", value, {
								dontUpdateMeta: true,
							});
						if (form.getFieldMeta("mailNickname")?.isDirty !== true)
							form.setFieldValue("mailNickname", value, {
								dontUpdateMeta: true,
							});
					}}
				/>
				<Show when={getFormError(form, "name")}>
					{(error) => <p class="text-red-500">{error()}</p>}
				</Show>

				<div class="flex items-end space-x-2">
					<InputField
						form={form}
						name="upnLocal"
						label="User principal name"
						placeholder="john"
						autocomplete="off"
					/>

					<div class="h-10 flex items-center">
						<p>@</p>
					</div>

					{/* // TODO: This select breaks after being changed once. It just stops accepting input???? */}
					<SelectField
						form={form}
						name="upnRemote"
						fieldClass="flex-1"
						disabled={org.loading || org()?.verifiedDomains.length === 0}
						options={org()?.verifiedDomains.map((d) => d.name) ?? []}
						placeholder={
							<Show when={org.loading}>
								<span class="text-muted-foreground/70">Loading...</span>
							</Show>
						}
						itemComponent={(props) => (
							<SelectItem item={props.item}>{props.item.rawValue}</SelectItem>
						)}
					>
						<SelectTrigger
							aria-label="User principal name domain"
							class="w-[180px]"
						>
							<SelectValue<string>>
								{(state) => state.selectedOption()}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</SelectField>
				</div>

				<div class="flex items-end space-x-2">
					<InputField
						form={form}
						name="password"
						label="Password"
						placeholder="password"
						type={passwordVisible() ? "text" : "password"}
						fieldClass="flex-1"
						autocomplete="off"
					/>

					{/* <Button
						variant="secondary"
						onClick={() =>
							form.setFieldValue("password", generateDefaultPassword())
						}
					>
						<IconPhArrowClockwiseBold />
					</Button> */}
					{/* // form.setFieldValue("password", generateDefaultPassword()) */}
					{/* // TODO: Inset into field or not? */}
					<Button
						variant="secondary"
						onClick={() => setPasswordVisible(!passwordVisible())}
					>
						<IconPhEyeBold
							class="transform transition"
							classList={{
								"scale-125": passwordVisible(),
							}}
						/>
					</Button>
				</div>
				{/* // TODO: password policy */}

				<CheckboxField
					form={form}
					name="accountEnabled"
					label="Account enabled"
					autocomplete="off"
					description="Should this user be allowed to sign in?"
				/>

				<Accordion multiple={true} collapsible>
					<AccordionItem value="advanced">
						<AccordionTrigger>Advanced</AccordionTrigger>
						<AccordionContent class="p-2">
							<InputField
								form={form}
								name="mailNickname"
								label="Mail nickname"
								placeholder="john"
								autocomplete="off"
							/>

							{/* // TODO: Extra properties */}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value="assignments">
						<AccordionTrigger>Assignments</AccordionTrigger>
						<AccordionContent class="p-2">
							{/* // TODO: Assignments */}
							Yes. It adheres to the WAI-ARIA design pattern.
						</AccordionContent>
					</AccordionItem>
				</Accordion>

				<div class="flex-1" />

				<SheetFooter class="items-center">
					{/* // TODO: Ignore form errors on this */}
					<Show when={error()}>
						{(error) => <p class="text-red-600 text-sm">Error: {error()}</p>}
					</Show>

					<div class="flex-1" />

					<Button type="submit" disabled={!isValid() || error() !== undefined}>
						Create
					</Button>
				</SheetFooter>
			</Form>
		</SheetContent>
	);
}

const letters = "abcdefghijklmnopqrstuvwxyz";

// This algorithm should be the same as Microsoft's whether it's good is a different question
// I feel like the pattern is way to predictable so that's not great!
function generateDefaultPassword() {
	let pass = letters.charAt(Math.floor(Math.random() * 10)).toUpperCase();
	for (let i = 0; i < 3; i++)
		pass += letters.charAt(Math.floor(Math.random() * 10));
	for (let i = 0; i < 6; i++) pass += Math.floor(Math.random() * 10);
	return pass;
}
