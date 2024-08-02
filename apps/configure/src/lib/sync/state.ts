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
	callback: (data: OperationResponse | OperationResponse[]) => Promise<void>;
};

// We push/pop from these globals. Similar to SolidJS
const operations: OperationGroup[] = [];
let progress: { id: string; total: number; current: number }[] = [];

export function registerBatchedOperation(
	op: Operation | Operation[],
	// It is safe to assume `responses` will always match the order of `op`
	callback: (responses: OperationResponse[]) => Promise<void> | void,
) {
	if (Array.isArray(op) && op.length === 0) return;
	operations.push({
		ops: Array.isArray(op) ? op : [op],
		callback: callback as any,
	});
}

export function popOperations() {
	return operations.splice(0, operations.length);
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
