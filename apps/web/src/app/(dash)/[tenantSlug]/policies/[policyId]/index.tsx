import { Timeline } from "@mattrax/ui";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { usePolicy } from "./Context";
import { StatItem } from "~/components/StatItem";

export default function Page() {
	const policy = usePolicy();

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			{/* <dl class="gap-5 flex">
				<StatItem title="Users" value={69} />
				<StatItem title="Devices" value={69} />
				<StatItem title="Policies" value={69} />
				<StatItem title="Applications" value={69} />
				<StatItem title="Groups" value={69} />
			</dl> */}

			{/* <Timeline
				items={[
					{
						title: "Event #1",
						description: "This is the first event of the timeline.",
					},
					{
						title: "Event #2",
						description: "This is the second event of the timeline.",
					},
					{
						title: "Event #3",
						description: "This is the third event of the timeline.",
					},
				]}
				activeItem={1}
			/> */}
		</PageLayout>
	);
}
