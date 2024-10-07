// Most of this file is copied from Solid Start so credit to the original author

import {
	crossSerializeStream,
	deserialize,
	getCrossReferenceHeader,
} from "seroval";

export function toReadableStream<T>(result: T) {
	let cancel: () => void;
	return new ReadableStream({
		start: (controller) =>
			(cancel = crossSerializeStream(result, {
				onSerialize: (data, initial) =>
					controller.enqueue(
						createChunk(
							initial ? `(${getCrossReferenceHeader()},${data})` : data,
						),
					),

				onError: (err) => controller.error(err),
				onDone: () => controller.close(),
			})),
		cancel: () => {
			if (cancel) cancel();
		},
	});
}

function createChunk(data: string) {
	const encodeData = new TextEncoder().encode(data);
	const bytes = encodeData.length;
	const baseHex = bytes.toString(16);
	const totalHex = "00000000".substring(0, 8 - baseHex.length) + baseHex; // 32-bit
	const head = new TextEncoder().encode(`;0x${totalHex};`);

	const chunk = new Uint8Array(12 + bytes);
	chunk.set(head);
	chunk.set(encodeData, 12);
	return chunk;
}

export async function fromBody(body: ReadableStream<Uint8Array>) {
	const reader = new SerovalChunkReader(body);

	const result = await reader.next();

	if (!result.done) {
		reader.drain().then(
			() => {
				// @ts-ignore
				// biome-ignore lint/performance/noDelete:
				delete globalThis.$R;
			},
			() => {
				// no-op
			},
		);
	}

	return result.value;
}

class SerovalChunkReader {
	reader: ReadableStreamDefaultReader<Uint8Array>;
	buffer: Uint8Array;
	done: boolean;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader();
		this.buffer = new Uint8Array(0);
		this.done = false;
	}

	async readChunk() {
		// if there's no chunk, read again
		const chunk = await this.reader.read();
		if (!chunk.done) {
			// repopulate the buffer
			const newBuffer = new Uint8Array(this.buffer.length + chunk.value.length);
			newBuffer.set(this.buffer);
			newBuffer.set(chunk.value, this.buffer.length);
			this.buffer = newBuffer;
		} else {
			this.done = true;
		}
	}

	async next(): Promise<any> {
		// Check if the buffer is empty
		if (this.buffer.length === 0) {
			// if we are already done...
			if (this.done) {
				return {
					done: true,
					value: undefined,
				};
			}
			// Otherwise, read a new chunk
			await this.readChunk();
			return await this.next();
		}
		// Read the "byte header"
		// The byte header tells us how big the expected data is
		// so we know how much data we should wait before we
		// deserialize the data
		const head = new TextDecoder().decode(this.buffer.subarray(1, 11));
		const bytes = Number.parseInt(head, 16); // ;0x00000000;
		// Check if the buffer has enough bytes to be parsed
		while (bytes > this.buffer.length - 12) {
			// If it's not enough, and the reader is done
			// then the chunk is invalid.
			if (this.done) {
				throw new Error("Malformed server function stream.");
			}
			// Otherwise, we read more chunks
			await this.readChunk();
		}
		// Extract the exact chunk as defined by the byte header
		const partial = new TextDecoder().decode(
			this.buffer.subarray(12, 12 + bytes),
		);
		// The rest goes to the buffer
		this.buffer = this.buffer.subarray(12 + bytes);

		// Deserialize the chunk
		return {
			done: false,
			value: deserialize(partial),
		};
	}

	async drain() {
		while (true) {
			const result = await this.next();
			if (result.done) {
				break;
			}
		}
	}
}
