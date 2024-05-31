export class OrgRealtime {
	constructor(state: DurableObjectState, env: Env) {}

	async fetch(request) {
		return new Response("Hello World From Durable Object!");
	}
}
