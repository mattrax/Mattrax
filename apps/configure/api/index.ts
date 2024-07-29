const kv = await Deno.openKv();

Deno.serve(async (req) => {
	const url = new URL(req.url);

	// TODO: Workspace vs personal views

	if (req.method === "GET" && url.pathname === "/api/views") {
		// TODO: Authenticate client
		const userId = "user"; // TODO: Get from auth

		const body = await kv.get(["views", "user", userId]);

		return new Response(JSON.stringify(body.value || []), {
			headers: {
				"content-type": "application/json",
			},
		});
	} else if (req.method === "POST" && url.pathname === "/api/views") {
		// TODO: Authenticate client
		const userId = "user"; // TODO: Get from auth

		// TODO: Input validation
		const body = await req.json();

		await kv.set(["views", "user", userId], body);
		return new Response("", {
			status: 204,
		});
	}

	return new Response("Mattrax Configure!");
});
