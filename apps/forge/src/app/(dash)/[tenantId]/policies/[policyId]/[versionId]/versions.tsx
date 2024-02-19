import { createTimeAgo } from "@solid-primitives/date";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui";
import {
  Progress,
  ProgressLabel,
  ProgressValueLabel,
} from "~/components/ui/progress";

export default function Page() {
  // TODO: Show scope and deploy progress

  const deploy = {
    description: "I fixed a boo boo",
    by: "Oscar",
    when: new Date(),
  };

  const [timeago] = createTimeAgo(deploy.when);
  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Status</h2>

      <Card class="flex flex-col">
        <CardHeader class="flex-row w-full justify-between space-y-0">
          <div>
            <CardTitle>
              Deployed by <span class="font-medium">{deploy.by}</span>{" "}
              {timeago()}
            </CardTitle>
            <CardDescription>{deploy.description}</CardDescription>
          </div>
          <div>
            <Progress
              value={3}
              minValue={0}
              maxValue={10}
              getValueLabel={({ value, max }) =>
                `${value} of ${max} devices completed`
              }
              class="w-[300px] space-y-1"
            >
              <div class="flex justify-between">
                <ProgressLabel>Deploying...</ProgressLabel>
                <ProgressValueLabel />
              </div>
            </Progress>
          </div>
        </CardHeader>
        <CardContent>
          {/* // TODO: Show state of each device and show failure information */}
        </CardContent>
      </Card>

      {/* // TODO: Maybe show all versions */}
    </div>
  );
}
