import { useNavigate } from "@solidjs/router";
import { ErrorBoundary, For, Suspense } from "solid-js";
import { useAccessToken } from "../(dash)";
import { logout } from "../../util/auth";
import { createIdbQuery, db, invalidateStore } from "../../util/db";
import {
	syncAll,
	syncEntityWithDelta,
	syncEntityWithoutDelta,
	useUser,
} from "../../util/sync";

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

	// TODO: Full-text search???

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
						syncAll(accessToken).then(() =>
							alert(`Synced in ${performance.now() - now}ms`),
						);
					}}
				>
					Sync All
				</button>
				<button
					type="button"
					onClick={() =>
						syncEntityWithDelta(accessToken, "users", (user) => ({
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
						syncEntityWithDelta(accessToken, "devices", (device) => {
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
						syncEntityWithDelta(accessToken, "groups", (group) => {
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
						syncEntityWithoutDelta(
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
						syncEntityWithoutDelta(
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
				</button>
				<button type="button" onClick={() => clearUsers()}>
					Reset users
				</button>
				<button
					type="button"
					onClick={() => {
						logout();
						navigate("/");
					}}
				>
					Logout
				</button>
			</div>
			{/* {syncing.loading ? <p>Syncing...</p> : null} */}
			<input type="search" placeholder="Search users..." />
			<ErrorBoundary fallback={null}>
				<Suspense fallback={<p>Loading...</p>}>
					{/* TODO: Render accountEnabled */}
					{/* <pre>{JSON.stringify(users(), null, 2)}</pre> */}
					<For each={users.data} fallback={<p>No users found...</p>}>
						{(user) => <pre>{user.name}</pre>}
					</For>
				</Suspense>
			</ErrorBoundary>
		</>
	);
}
