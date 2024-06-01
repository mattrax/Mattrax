import type * as jose from "jose";
import { env } from "~/env";

export async function signJWT<T extends jose.JWTPayload>(
	payload: T,
	opts?: {
		expirationTime?: Date | number;
		/** @defaultValue `mattrax.app` */
		audience?: string;
	},
) {
	const jose = await import("jose");

	const builder = new jose.SignJWT(payload)
		.setAudience(opts?.audience ?? "mattrax.app")
		.setNotBefore(new Date());

	if (opts?.expirationTime)
		builder.setExpirationTime(new Date(opts.expirationTime));

	return await builder
		.setProtectedHeader({ alg: "HS256" })
		.sign(createSecretKey());
}

export async function verifyJWT<T extends jose.JWTPayload>(jwt: string) {
	const jose = await import("jose");
	const result = await jose.jwtVerify<T>(jwt, createSecretKey());
	return result.payload;
}

export async function encryptJWT<T extends jose.JWTPayload>(
	payload: T,
	opts?: {
		expirationTime?: Date | number;
		/** @defaultValue `mattrax.app` */
		audience?: string;
	},
) {
	const jose = await import("jose");
	const builder = new jose.EncryptJWT(payload)
		.setAudience(opts?.audience ?? "mattrax.app")
		.setNotBefore(new Date());

	if (opts?.expirationTime)
		builder.setExpirationTime(new Date(opts.expirationTime));

	return await builder
		.setProtectedHeader({
			alg: "PBES2-HS256+A128KW",
			enc: "A128CBC-HS256",
		})
		.encrypt(createSecretKey());
}

export async function decryptJWT(
	jwt: string,
	opts?: {
		/** @defaultValue `mattrax.app` */
		audience?: string;
	},
) {
	const jose = await import("jose");
	return await jose.jwtDecrypt(jwt, createSecretKey(), {
		keyManagementAlgorithms: ["PBES2-HS256+A128KW"],
	});
}

function createSecretKey() {
	return new TextEncoder().encode(env.INTERNAL_SECRET);
}
