export type Operation = {
	id: string;
	method: "GET" | "POST" | "PATCH" | "DELETE";
	url: string;
	headers?: Record<string, string>;
};

export type OperationResponse = {
	id: string;
	body: unknown;
	headers: Record<string, string>;
	status: number;
};

export type OperationGroup = {
	ops: Operation[];
	callback: (data: OperationResponse[]) => Promise<void> | void;
};

export type Scope = {
	operations: OperationGroup[];
	callback: () => Promise<void> | void;
};

// We push/pop from these globals. Similar to SolidJS
// const operations: OperationGroup[] = [];
let nextScopeId = 0;
let scopes: Record<number, Scope> = {};
let progress: { id: string; total: number; current: number }[] = [];

export function createScope(callback: () => Promise<void> | void) {
	nextScopeId += 1;
	const scopeId = nextScopeId;

	scopes[scopeId] = {
		operations: [],
		callback,
	};

	return {
		// It is safe to assume these will fire the order they were registered
		registerOperation(
			op: Operation | Operation[],
			// It is safe to assume `responses` will always match the order of `op`
			callback: (responses: OperationResponse[]) => Promise<void> | void,
		) {
			if (Array.isArray(op) && op.length === 0) return;
			scopes[scopeId]!.operations.push({
				ops: Array.isArray(op) ? op : [op],
				callback: callback as any,
			});
		},
	};
}

// It is safe to assume these will fire the order they were registered
export function registerBatchedOperation(
	op: Operation | Operation[],
	// It is safe to assume `responses` will always match the order of `op`
	callback: (responses: OperationResponse[]) => Promise<void> | void,
) {
	createScope(() => {}).registerOperation(op, callback);
}

export function popScopes() {
	const s = Object.values(scopes);
	scopes = {};
	return s;
}

export function registerProgress(id: string, total: number, current: number) {
	progress = progress.filter((p) => p.id !== id);
	progress.push({ id, total, current });
}

export function getProgress() {
	return progress;
}

export function clearProgress() {
	progress = [];
}
