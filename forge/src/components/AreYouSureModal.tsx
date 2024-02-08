import { type JSX, ParentProps, createSignal } from "solid-js";
import {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Button,
  useController,
} from "./ui";

type Props = ParentProps<{
  stringToType: string;
  description: JSX.Element;
  mutate: () => Promise<void>;
}>;

export function AreYouSureModal(props: Props) {
  return (
    <DialogRoot>
      <DialogTrigger asChild>{props.children}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete tenant?</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>

        <Inner {...props} />
      </DialogContent>
    </DialogRoot>
  );
}

function Inner(props: Props) {
  const controller = useController();
  const [input, setInput] = createSignal("");
  const [isPending, setIsPending] = createSignal(false);

  return (
    <>
      <p class="text-muted-foreground text-sm">
        To confirm, type "{props.stringToType}" in the box below
      </p>
      <Input
        value={input()}
        onInput={(e) => setInput(e.currentTarget.value)}
        disabled={isPending()}
      />
      <Button
        variant="destructive"
        disabled={isPending() || input() !== props.stringToType}
        onClick={() => {
          setIsPending(true);
          props
            .mutate()
            .then(() => void controller.setOpen(false))
            .finally(() => setIsPending(false));
        }}
      >
        Delete "{props.stringToType}"
      </Button>
    </>
  );
}
