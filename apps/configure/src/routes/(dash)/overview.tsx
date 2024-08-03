import { Button } from "@mattrax/ui";
import { createAsync, createAsyncStore } from "@solidjs/router";
import type { IDBPDatabase } from "idb";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { StatItem } from "~/components/StatItem";
import { type Database, db } from "~/lib/db";

function useReactiveQuery<T>(
	query: (db: IDBPDatabase<Database>) => Promise<T> | T,
) {
	// TODO: Maybe use resource???
	const [refetch, setRefetch] = createSignal(0);
	const result = createAsyncStore(async () => {
		refetch();
		return await query(await db);
	});

	// TODO: Typescript support
	// TODO: Cross-tab support

	// TODO: Determine the scope from the user/transaction somehow
	const objectStores = ["_kv"] as const;

	// TODO: Really we should setup in `createAsyncStore` or something cause this might miss early updates
	db.then((db) => {
		const observer = db.observe(objectStores, (changes, metadata) => {
			console.log("OBSERVE", changes, metadata);
			setRefetch((v) => v + 1);
		});
		onCleanup(() => observer.stop());
	});

	return result;
}

export default function Page() {
	const counts = createAsync(async () => {
		return {
			users: await (await db).count("users"),
			devices: await (await db).count("devices"),
			groups: await (await db).count("groups"),
			policies: await (await db).count("policies"),
			applications: await (await db).count("apps"),
		};
	});

	const data = useReactiveQuery(async (db) => await db.getAll("_kv"));

	createEffect(() => console.log("KV", { ...data() }));

	// db.then((db) => {});

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			<div class="grid gap-4 grid-cols-5">
				<StatItem
					title="Users"
					href="users"
					icon={<IconPhUser />}
					value={counts()?.users || 0}
				/>
				<StatItem
					title="Devices"
					href="devices"
					icon={<IconPhDevices />}
					value={counts()?.devices || 0}
				/>
				<StatItem
					title="Policies"
					href="policies"
					icon={<IconPhScroll />}
					value={counts()?.policies || 0}
				/>
				<StatItem
					title="Applications"
					href="apps"
					icon={<IconPhAppWindow />}
					value={counts()?.applications || 0}
				/>
				<StatItem
					title="Groups"
					href="groups"
					icon={<IconPhSelection />}
					value={counts()?.groups || 0}
				/>
			</div>

			<Button
				onClick={async () => {
					// TODO: Use mutation primitive
					await (await db).put("_kv", Date.now().toString(), "test");
				}}
			>
				Update
			</Button>
			<p>{data()?.test || "not found!"}</p>
		</PageLayout>
	);
}
