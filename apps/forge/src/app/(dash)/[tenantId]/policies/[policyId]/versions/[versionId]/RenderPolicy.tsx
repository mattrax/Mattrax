import { For } from "solid-js";
import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui";
import { InferPolicyData } from "@mattrax/policies";
import { PolicyDefinition } from "@mattrax/policies";
import { z } from "zod";

export function RenderPolicy<P extends PolicyDefinition>(props: {
  data: InferPolicyData<P>;
  policy: P;
}) {
  // TODO: Render the data from `props.data`
  // TODO: When changed push the changes to the backend
  // TODO: Get the Zod default and render it if the field is missing from `props.data`

  return (
    <For each={Object.entries(props.policy)} fallback={<div>Loading...</div>}>
      {([key, def]) => {
        let input = null;

        let [defaultValue, rest] =
          def.schema instanceof z.ZodDefault
            ? [def.schema._def.defaultValue(), def.schema._def.innerType]
            : [undefined, def.schema];

        // TODO: Push changes to any of these to the backend
        if (rest instanceof z.ZodBoolean) {
          input = (
            <Checkbox
              checked={props.data?.[key] ?? defaultValue ?? false}
              onChange={
                (camera) => {}

                // policyUpdate.mutate({
                //   policyId: params.policyId!,
                //   policy: [
                //     {
                //       camera,
                //     },
                //   ],
                // })
              }
            />
          );
        } else if (rest instanceof z.ZodString) {
          input = <Input />;
        } else if (rest instanceof z.ZodNumber) {
          input = <Input type="number" />;
        } else if (rest instanceof z.ZodUnion) {
          input = (
            <Select
              // value={value()}
              // onChange={setValue}
              options={rest.options.map((option: any) => {
                if (!(option instanceof z.ZodString))
                  throw new Error("Minor bruh moment");
                return option.description;
              })}
              // placeholder="Select a fruit…"
              itemComponent={(props) => (
                <SelectItem item={props.item}>
                  {props.item.rawValue as any}
                </SelectItem>
              )}
            >
              <SelectTrigger aria-label="Fruit" class="w-[180px]">
                <SelectValue<string>>
                  {(state) => state.selectedOption()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
          );
        } else {
          console.log(rest);
          throw new Error("Mega bruh moment");
        }

        return (
          <div class="items-top flex space-x-2">
            {input}
            <div class="grid gap-1.5 leading-none">
              <Label for="terms1-input">{def.title}</Label>
              <p class="text-muted-foreground text-sm">{def.description}</p>
            </div>
          </div>
        );
      }}
    </For>
  );
}
