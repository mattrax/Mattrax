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
import DashboardImg from "../assets/dashboard.png";
import LandingButton from "~/components/LandingButton";
import { FaSolidCircleInfo, FaSolidEnvelope } from "solid-icons/fa";
import Social from "~/components/Social";
import linetwo from "../assets/linetwo.svg";
import lineone from "../assets/lineone.svg";
import Bento from "~/components/Bento";
import Cta from "~/components/Cta";
import Footer from "~/components/Footer";

// TODO: Setup unplugin icons
function PhLaptop(props: JSX.IntrinsicElements["svg"]) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      {...props}
    >
      <title>Laptop Icon</title>
      <path
        fill="currentColor"
        d="M232 168h-8V72a24 24 0 0 0-24-24H56a24 24 0 0 0-24 24v96h-8a8 8 0 0 0-8 8v16a24 24 0 0 0 24 24h176a24 24 0 0 0 24-24v-16a8 8 0 0 0-8-8M48 72a8 8 0 0 1 8-8h144a8 8 0 0 1 8 8v96H48Zm176 120a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8v-8h192ZM152 88a8 8 0 0 1-8 8h-32a8 8 0 0 1 0-16h32a8 8 0 0 1 8 8"
      />
    </svg>
  );
}

function PhGear(props: JSX.IntrinsicElements["svg"]) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      {...props}
    >
      <title>Gear Icon</title>
      <path
        fill="currentColor"
        d="M128 80a48 48 0 1 0 48 48a48.05 48.05 0 0 0-48-48m0 80a32 32 0 1 1 32-32a32 32 0 0 1-32 32m88-29.84q.06-2.16 0-4.32l14.92-18.64a8 8 0 0 0 1.48-7.06a107.21 107.21 0 0 0-10.88-26.25a8 8 0 0 0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186 40.54a8 8 0 0 0-3.94-6a107.71 107.71 0 0 0-26.25-10.87a8 8 0 0 0-7.06 1.49L130.16 40h-4.32L107.2 25.11a8 8 0 0 0-7.06-1.48a107.6 107.6 0 0 0-26.25 10.88a8 8 0 0 0-3.93 6l-2.64 23.76q-1.56 1.49-3 3L40.54 70a8 8 0 0 0-6 3.94a107.71 107.71 0 0 0-10.87 26.25a8 8 0 0 0 1.49 7.06L40 125.84v4.32L25.11 148.8a8 8 0 0 0-1.48 7.06a107.21 107.21 0 0 0 10.88 26.25a8 8 0 0 0 6 3.93l23.72 2.64q1.49 1.56 3 3L70 215.46a8 8 0 0 0 3.94 6a107.71 107.71 0 0 0 26.25 10.87a8 8 0 0 0 7.06-1.49L125.84 216q2.16.06 4.32 0l18.64 14.92a8 8 0 0 0 7.06 1.48a107.21 107.21 0 0 0 26.25-10.88a8 8 0 0 0 3.93-6l2.64-23.72q1.56-1.48 3-3l23.78-2.8a8 8 0 0 0 6-3.94a107.71 107.71 0 0 0 10.87-26.25a8 8 0 0 0-1.49-7.06Zm-16.1-6.5a73.93 73.93 0 0 1 0 8.68a8 8 0 0 0 1.74 5.48l14.19 17.73a91.57 91.57 0 0 1-6.23 15l-22.6 2.56a8 8 0 0 0-5.1 2.64a74.11 74.11 0 0 1-6.14 6.14a8 8 0 0 0-2.64 5.1l-2.51 22.58a91.32 91.32 0 0 1-15 6.23l-17.74-14.19a8 8 0 0 0-5-1.75h-.48a73.93 73.93 0 0 1-8.68 0a8 8 0 0 0-5.48 1.74l-17.78 14.2a91.57 91.57 0 0 1-15-6.23L82.89 187a8 8 0 0 0-2.64-5.1a74.11 74.11 0 0 1-6.14-6.14a8 8 0 0 0-5.1-2.64l-22.58-2.52a91.32 91.32 0 0 1-6.23-15l14.19-17.74a8 8 0 0 0 1.74-5.48a73.93 73.93 0 0 1 0-8.68a8 8 0 0 0-1.74-5.48L40.2 100.45a91.57 91.57 0 0 1 6.23-15L69 82.89a8 8 0 0 0 5.1-2.64a74.11 74.11 0 0 1 6.14-6.14A8 8 0 0 0 82.89 69l2.51-22.57a91.32 91.32 0 0 1 15-6.23l17.74 14.19a8 8 0 0 0 5.48 1.74a73.93 73.93 0 0 1 8.68 0a8 8 0 0 0 5.48-1.74l17.77-14.19a91.57 91.57 0 0 1 15 6.23L173.11 69a8 8 0 0 0 2.64 5.1a74.11 74.11 0 0 1 6.14 6.14a8 8 0 0 0 5.1 2.64l22.58 2.51a91.32 91.32 0 0 1 6.23 15l-14.19 17.74a8 8 0 0 0-1.74 5.53Z"
      />
    </svg>
  );
}

function PhGitCommit(props: JSX.IntrinsicElements["svg"]) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#000000"
      viewBox="0 0 256 256"
      {...props}
    >
      <title>Git Commit Icon</title>
      <path d="M248,120H183.42a56,56,0,0,0-110.84,0H8a8,8,0,0,0,0,16H72.58a56,56,0,0,0,110.84,0H248a8,8,0,0,0,0-16ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z" />
    </svg>
  );
}

function PhAppWindow(props: JSX.IntrinsicElements["svg"]) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#000000"
      viewBox="0 0 256 256"
      {...props}
    >
      <title>App Window Icon</title>
      <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200ZM80,84A12,12,0,1,1,68,72,12,12,0,0,1,80,84Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,120,84Z" />
    </svg>
  );
}

export default function Page() {
  // const form = createZodForm({});

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
            <LandingButton class="mx-auto mb-12" variant="black">
              <FaSolidCircleInfo />
              Launching Alpha in mid-2024
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

            <div class="pt-4 flex justify-center">
              <Waitlist />
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
        <FaSolidEnvelope />
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

  const form = createZodForm({
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
          await resp.text()
        );
        alert(
          "Error adding you to the waitlist. Please try again or email hello@mattrax.app"
        );
        return;
      }

      controller.setOpen(false);
    },
  });

  // `state().isValid` seems to be always `true` (probs cause `createZodForm` only does validation on submit) // TODO: Maybe fix this properly?
  const isFormValid = form.useStore(
    (state) => schema.safeParse(state.values).success
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
