import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	useController,
} from "@mattrax/ui";
import {
	Form,
	InputField,
	SelectField,
	createZodForm,
} from "@mattrax/ui/forms";
import type { JSX } from "solid-js";
import { z } from "zod";
import Bento from "~/components/Bento";
import Cta from "~/components/Cta";
import Footer from "~/components/Footer";
import LandingButton, {
	landingButtonVariants,
} from "~/components/LandingButton";
import Social from "~/components/Social";
import DashboardImg from "../assets/dashboard.png";
import lineone from "../assets/lineone.svg?url";
import linetwo from "../assets/linetwo.svg?url";

export default function Page() {
	return (
		<main>
			<div class="mt-32 sm:mt-28">
				<div class="mx-auto max-w-7xl px-6 lg:px-8 relative">
					<div
						style={{
							"background-image": `url(${lineone})`,
							"background-size": "contain",
							"background-repeat": "no-repeat",
						}}
						class="absolute bottom-[-50%] sm:bottom-[2%] w-[191px] h-[622px]"
					/>
					<div
						style={{
							"background-image": `url(${linetwo})`,
							"background-size": "contain",
							"background-repeat": "no-repeat",
						}}
						class="absolute right-[5%] sm:bottom-[3%] top-[-35%] sm:top-[-15%] w-[110px] h-[628px]"
					/>
					<div class="mx-auto max-w-3xl sm:text-center relative">
						<LandingButton class="mx-auto mb-12" variant="black" disabled>
							<IconFa6SolidCircleInfo />
							Launching Alpha in late-2024
						</LandingButton>

						<p class="mt-2 mb-20 text-center text-4xl sm:text-6xl font-bold tracking-tight text-gray-900">
							Mattrax MDM
						</p>
						<h2 class="text-3xl text-center leading-10 sm:text-5xl text-black">
							All your <span class="font-bold">devices</span>, one{" "}
							<span class="font-bold">dashboard</span>
						</h2>
						<p class="mt-4 mb-5 text-lg text-center leading-8 text-zinc-500">
							Mattrax MDM is a full device management solution with the ability
							to manage your organisations entire fleet from a single,
							well-crafted dashboard.
						</p>

						<div class="pt-4 flex flex-wrap justify-center gap-2">
							<Waitlist />
							<a
								href="https://cal.com/mattrax"
								class={landingButtonVariants({})}
								target="_blank"
								rel="noreferrer"
								draggable="false"
							>
								<IconFa6SolidPhone />
								Discuss your needs
							</a>
						</div>
						<Social />
					</div>
				</div>
				<div class="relative overflow-hidden pt-10 mt-20">
					<div class="mx-auto max-w-7xl px-6 lg:px-8">
						<img
							src={DashboardImg}
							alt="Mattrax Dashboard"
							class="mb-[-12%] rounded-xl shadow-2xl ring-1 ring-gray-900/10"
							width={2432}
							height={1442}
						/>
						<div class="relative" aria-hidden="true">
							<div class="absolute -inset-x-20 bottom-0 bg-gradient-to-t from-white pt-[7%]" />
						</div>
					</div>
				</div>
				<Bento />
				<p class="text-center text-lg">
					That's not it - <b>there's more...</b>
				</p>
				<Cta />
			</div>
			<div class="flex justify-center items-center pt-4 mb-5">
				<Footer />
			</div>
		</main>
	);
}

function Waitlist() {
	return (
		<Dialog>
			<DialogTrigger as={LandingButton}>
				<IconFaSolidEnvelope />
				Join waitlist
			</DialogTrigger>
			<DialogContent class="md:w-auto w-11/12">
				<DialogHeader>
					<DialogTitle>Join Waitlist</DialogTitle>
					<DialogDescription>
						We will keep you updated with Mattrax's development!
						<br /> You can unsubscribe at any time.
					</DialogDescription>
				</DialogHeader>

				<DropdownBody />
			</DialogContent>
		</Dialog>
	);
}

const getObjectKeys = <T extends object>(obj: T) =>
	Object.keys(obj) as (keyof T)[];

function zodEnumFromObjectKeys<K extends string>(obj: Record<K, any>) {
	return z.enum([getObjectKeys(obj)[0]!, ...getObjectKeys(obj)]);
}

const interestReasons = {
	personal: "Personal",
	"internal-it-team": "Internal IT Team",
	"msp-provider": "MSP Provider",
	other: "Other",
} as const;

const deploymentMethod = {
	"managed-cloud": "Managed Cloud",
	"private-cloud": "Private Cloud",
	onprem: "On Premise",
	other: "Other",
} as const;

function DropdownBody() {
	const controller = useController();

	const schema = z.object({
		email: z.string().email(),
		name: z.string().optional(),
		interest: zodEnumFromObjectKeys(interestReasons),
		deployment: zodEnumFromObjectKeys(deploymentMethod),
	});

	const form = createZodForm(() => ({
		schema,
		onSubmit: async ({ value }) => {
			// This endpoint is defined in Nitro and proxies to `cloud.mattrax.app` so we can avoid CORS
			const resp = await fetch("/api/waitlist", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(value),
			});
			if (!resp.ok) {
				console.error(
					"Error applying to waitlist",
					resp.status,
					await resp.text(),
				);
				alert(
					"Error adding you to the waitlist. Please try again or email hello@mattrax.app",
				);
				return;
			}

			controller.setOpen(false);
		},
	}));

	// `state().isValid` seems to be always `true` (probs cause `createZodForm` only does validation on submit) // TODO: Maybe fix this properly?
	const isFormValid = form.useStore(
		(state) => schema.safeParse(state.values).success,
	);

	return (
		<Form form={form} fieldsetClass="flex flex-col space-y-4">
			<InputField form={form} name="email" label="Email" autocomplete="email" />
			<InputField
				form={form}
				name="name"
				label="Name (optional)"
				autocomplete="name"
			/>

			<SelectField
				form={form}
				name="interest"
				label="Why are you interested?"
				options={["personal", "internal-it-team", "msp-provider", "other"]}
				placeholder="Select a reason..."
				itemComponent={(props) => (
					<SelectItem item={props.item}>
						{interestReasons[props.item.rawValue]}
					</SelectItem>
				)}
			>
				<SelectTrigger>
					<SelectValue<keyof typeof interestReasons>>
						{(state) => interestReasons[state.selectedOption()]}
					</SelectValue>
				</SelectTrigger>
				<SelectContent />
			</SelectField>

			<SelectField
				form={form}
				name="deployment"
				label="How will you use Mattrax?"
				options={["managed-cloud", "private-cloud", "onprem", "other"]}
				placeholder="Select a method..."
				itemComponent={(props) => (
					<SelectItem item={props.item}>
						{deploymentMethod[props.item.rawValue]}
					</SelectItem>
				)}
			>
				<SelectTrigger>
					<SelectValue<keyof typeof deploymentMethod>>
						{(state) => deploymentMethod[state.selectedOption()]}
					</SelectValue>
				</SelectTrigger>
				<SelectContent />
			</SelectField>

			<Button type="submit" disabled={!isFormValid()}>
				Submit
			</Button>
		</Form>
	);
}
