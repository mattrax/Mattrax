import { restrictions } from "@mattrax/policies";
import { useParams } from "@solidjs/router";
import { For } from "solid-js";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  useController,
} from "~/components/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { trpc } from "~/lib";
import { RenderPolicy } from "./RenderPolicy";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));

  console.log(policy.data);

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">General</h2>
      {/* // TODO: Form abstraction hooked up */}
      <div class="grid w-full max-w-sm items-center gap-1.5">
        <Label for="name">Name</Label>
        <Input
          type="email"
          id="name"
          placeholder="My Cool Policy"
          value={policy.data?.name}
          disabled
        />
      </div>
      <Card class="flex flex-col">
        <CardHeader class="flex-row w-full justify-between space-y-0">
          <div>
            <CardTitle>Script</CardTitle>
            <CardDescription>Basic tenant configuration.</CardDescription>
          </div>
          <div class="h-full flex justify-center justify-items-center content-center items-center">
            <Button variant="destructive" onClick={() => alert("TODO")}>
              Delete
            </Button>
          </div>
        </CardHeader>
        <CardContent class="flex-grow flex flex-col justify-between">
          {/* <InputField form={form} name="name" label="Name" /> */}
        </CardContent>
      </Card>
      <Card class="flex flex-col">
        <CardHeader>
          <CardTitle>Script</CardTitle>
          <CardDescription>Basic tenant configuration.</CardDescription>
        </CardHeader>
        <CardContent class="flex-grow flex flex-col justify-between">
          {/* <InputField form={form} name="name" label="Name" /> */}
        </CardContent>
        {/* <CardFooter>
          <Button type="submit">Save</Button>
        </CardFooter> */}
      </Card>
      <div class="flex w-full justify-center">
        <Popover>
          <NewPolicyPopover />
        </Popover>
      </div>
    </div>
  );
}

function NewPolicyPopover() {
  const controller = useController();

  return (
    <>
      <PopoverTrigger>
        <IconPhPlusCircleBold
          class="text-2xl hover:scale-110 transition"
          classList={{
            "scale-110": controller.open(),
          }}
        />
      </PopoverTrigger>
      <PopoverContent class="p-2">
        <For each={policyTypes}>
          {(item) => (
            <div class="hover:bg-accent hover:text-accent-foreground relative mt-0 flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none">
              <div class="flex justify-start items-center">
                <item.icon class="h-6 w-6 shrink-0" />
                <span class="pl-2">{item.name}</span>
              </div>
            </div>
          )}
        </For>
      </PopoverContent>
    </>
  );
}

// TODO: Break this out
const policyTypes = [
  {
    name: "Restrictions",
    icon: IconPhLockDuotone,
    policy: () => (
      <RenderPolicy
        data={{
          // TODO: Loading this data from the backend
          camera: true,
        }}
        policy={restrictions}
      />
    ),
  },
  {
    name: "Script",
    icon: IconPhClipboardDuotone,
  },
  {
    name: "Chrome",
    icon: IconLogosChrome,
  },
  {
    name: "Slack",
    icon: IconLogosSlackIcon,
  },
  {
    name: "Microsoft Office",
    icon: IconLogosMicrosoftIcon,
  },
];
