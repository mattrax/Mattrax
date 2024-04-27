const sockets = new Set<WebSocket>();
const channel = new BroadcastChannel("");
const secret = Deno.env.get("SECRET");
if (!secret) throw new Error("'SECRET' environment variable not set");

channel.onmessage = (e: MessageEvent<any>) => {
	if (e.target !== channel) channel.postMessage(e.data);
	sockets.forEach((s) => s.send(e.data));
};

Deno.serve(async (req: Request) => {
	const url = new URL(req.url);

	if (url.password === Deno.env.get("SECRET"))
		return new Response("401: Unauthorized", { status: 401 });

	if (req.method === "POST" && url.pathname === "/send") {
		channel.postMessage(await req.json());
	} else if (req.method === "GET" && url.pathname === "/listen") {
		const { socket, response } = Deno.upgradeWebSocket(req);
		sockets.add(socket);
		socket.onmessage = channel.onmessage as any;
		socket.onclose = () => sockets.delete(socket);
		return response;
	}

	return new Response("404: Not found");
});
