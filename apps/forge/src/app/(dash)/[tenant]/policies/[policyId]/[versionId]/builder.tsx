import { restrictions } from "@mattrax/policies";
import { useParams } from "@solidjs/router";
import { For, createSignal } from "solid-js";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

  // TODO: Form abstraction hooked up

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Builder</h2>
      <TriggerRow />
      <PolicyFlowControl disabled />
      <PolicyRow />
      <PolicyFlowControl />
      <PolicyRow />
      <div class="flex w-full justify-center">
        <Popover>
          <NewPolicyPopover />
        </Popover>
      </div>
    </div>
  );
}

function PolicyFlowControl(props: { disabled?: boolean }) {
  const [state, setState] = createSignal(false);
  const onClick = () => {
    if (!props.disabled) setState(!state());
  };

  return (
    <div class="flex w-full justify-center select-none">
      {state() ? (
        <IconPhAlarmBold
          class="text-2xl transition"
          onClick={onClick}
          classList={{
            "hover:scale-110": !props.disabled,
            "opacity-70": props.disabled,
          }}
        />
      ) : (
        <IconPhArrowCircleDownBold
          class="text-2xl transition"
          onClick={onClick}
          classList={{
            "hover:scale-110": !props.disabled,
            "opacity-70": props.disabled,
          }}
        />
      )}
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

function TriggerRow() {
  // TODO: Custom time to start policy
  // TODO: Trigger policy after another one

  return (
    <Card class="flex flex-col">
      <CardHeader class="flex-row w-full justify-center space-y-0">
        {/* <CardTitle>On Enrollment</CardTitle> */}
        <Select
          options={["On Enrollment", "On Checkin"]}
          placeholder="Select a fruit…"
          itemComponent={(props) => (
            <SelectItem item={props.item}>{props.item.rawValue}</SelectItem>
          )}
          // disabled={versions.isPending}
          multiple={true}
          disallowEmptySelection={true}
          // value={value()}
          defaultValue={["On Enrollment"]}
          onChange={(v) => {
            // TODO: Finish this
            // alert("TODO");
          }}
        >
          <SelectTrigger aria-label="Trigger Type" class="w-[180px]">
            <SelectValue<string>>
              {(state) => state.selectedOption()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      </CardHeader>
    </Card>
  );
}

function PolicyRow() {
  return (
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
