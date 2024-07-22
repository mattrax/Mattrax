import { useNavigate } from "@solidjs/router";
import {
	ErrorBoundary,
	For,
	Suspense,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
import { useAccessToken } from "../../util/auth";
import { createIdbQuery, db, invalidateStore } from "../../util/db";
import { syncAll, useUser } from "../../util/sync";

// TODO: Remove this
export async function clearUsers() {
	const tx = (await db).transaction(["users", "_meta"], "readwrite");
	tx.db.delete("_meta", "users");
	tx.db.clear("users");
	await tx.done;
	invalidateStore(["_meta", "users"]);
}

export default function Page() {
	const navigate = useNavigate();
	const accessToken = useAccessToken();

	const me = useUser();
	const users = createIdbQuery("users");
	const [query, setQuery] = createSignal("");

	// TODO: Make search work on all fields
	// TODO: Using indexes?
	// TODO: Maybe full-text search
	const filteredUsers = createMemo(() => {
		const q = query();
		if (q === "") return users.data || [];
		return (users.data || []).filter((user) =>
			user.name.toLowerCase().includes(q.toLowerCase()),
		);
	});

	return (
		<>
			<h1>Authenticated</h1>
			<ErrorBoundary fallback={<p>Failed to load user...</p>}>
				<Suspense fallback={<p>Loading...</p>}>
					<pre>{me.data?.name}</pre>
					<pre>{me.data?.upn}</pre>
				</Suspense>
			</ErrorBoundary>
			<div class="flex p-4 space-x-4">
				<button
					type="button"
					onClick={() => {
						const now = performance.now();
						syncAll(accessToken()).then(() =>
							alert(`Synced in ${performance.now() - now}ms`),
						);
					}}
				>
					Sync All
				</button>
				{/* <button
					type="button"
					onClick={() =>
						syncEntity(accessToken, "users", (user) => ({
							id: user.id,
							name: user.displayName,
							upn: user.userPrincipalName,
						})).then(() => alert("done"))
					}
				>
					Sync Users
				</button>
				<button
					type="button"
					onClick={() =>
						syncEntity(accessToken, "devices", (device) => {
							console.log(device);
							return {
								id: device.id,
								name: device.displayName,
							};
						}).then(() => alert("done"))
					}
				>
					Sync Devices
				</button>
				<button
					type="button"
					onClick={() =>
						syncEntity(accessToken, "groups", (group) => {
							console.log(group);
							return {
								id: group.id,
								name: group.displayName,
							};
						}).then(() => alert("done"))
					}
				>
					Sync Groups
				</button>
				<button
					type="button"
					onClick={() =>
						syncEntity(
							accessToken,
							"policies",
							(policy) => {
								console.log(policy);
								return {
									id: policy.id,
									name: policy.name,
								};
							},
							"deviceManagement/configurationPolicies",
						).then(() => alert("done"))
					}
				>
					Sync Policies
				</button>
				<button
					type="button"
					onClick={() =>
						syncEntity(
							accessToken,
							"apps",
							(app) => {
								console.log(app);
								return {
									id: app.id,
									name: app.displayName,
								};
							},
							"deviceAppManagement/mobileApps",
						).then(() => alert("done"))
					}
				>
					Sync Apps
				</button> */}
				<button type="button" onClick={() => clearUsers()}>
					Reset users
				</button>
			</div>
			{/* {syncing.loading ? <p>Syncing...</p> : null} */}
			<input
				type="search"
				onInput={(e) => setQuery(e.currentTarget.value)}
				placeholder="Search users..."
			/>
			<ErrorBoundary fallback={null}>
				<Suspense fallback={<p>Loading...</p>}>
					{/* // TODO: Render `accountEnabled` badge*/}
					<For each={filteredUsers()} fallback={<p>No users found...</p>}>
						{(user) => <pre>{user.name}</pre>}
					</For>
				</Suspense>
			</ErrorBoundary>
		</>
	);
}
