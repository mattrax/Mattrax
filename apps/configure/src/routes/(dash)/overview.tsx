import { createAsync, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Suspense } from "solid-js";
import { clearUsers, createIdbQuery, syncUsers } from "../../sync";
import { accessToken, logout } from "../../util";

export default function Page() {
	const navigate = useNavigate();

	const me = createAsync(async () => {
		const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
			headers: {
				Authorization: accessToken()!,
			},
		});
		if (!resp.ok) throw new Error("Failed to fetch user info");

		return await resp.json();
	});

	// const mePhoto = createAsync(async () => {
	//   const resp = await fetch("https://graph.microsoft.com/v1.0/me/photo", {
	//     headers: {
	//       Authorization: accessToken()!,
	//     },
	//   });

	//   let body: any | undefined;

	//   try {
	//     if (resp.status === 404) {
	//       body = JSON.parse(await resp.json());
	//       console.log(body); // TODO
	//       if (body?.error?.code === "ImageNotFound") return null;
	//     }
	//   } catch (e) {}

	//   if (!resp.ok) throw new Error("Failed to get profile photo");

	//   if (!body) body = await resp.json();
	//   return body;
	// });

	// TODO: We need a UI state to handle the original sync w/ a progress bar
	// const [syncing, { refetch: resync }] = createResource(async () =>
	//   syncUsers()
	// );

	const users = createIdbQuery("users");

	// TODO: Render before the sync is done but show indicator

	// TODO: Can we bind the UI directly to IndexedDB so changes across tabs sync???
	// TODO: Full-text search???

	return (
		<>
			<h1>Authenticated</h1>
			{/* TODO: Error boundary */}
			<Suspense fallback={<p>Loading...</p>}>
				<pre>{me()?.displayName}</pre>
				<pre>{me()?.userPrincipalName}</pre>
				{/* <pre>{JSON.stringify(mePhoto())}</pre> */}
			</Suspense>
			<div class="flex p-4 space-x-4">
				{/* <button type="button"  onClick={() => resync()} disabled={syncing.loading}>
          Sync
        </button> */}
				<button
					type="button"
					onClick={() => syncUsers().then(() => alert("done"))}
				>
					Sync
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
					<pre>{JSON.stringify(users(), null, 2)}</pre>
				</Suspense>
			</ErrorBoundary>
		</>
	);
}
