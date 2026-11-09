import { Schema } from "effect";

export const AzureOidcDiscovery = Schema.Struct({
  issuer: Schema.String,
  jwks_uri: Schema.String,
  authorization_endpoint: Schema.optional(Schema.String),
  token_endpoint: Schema.optional(Schema.String),
});
export type AzureOidcDiscovery = typeof AzureOidcDiscovery.Type;

export const JsonWebKey = Schema.Struct({
  kty: Schema.String,
  use: Schema.optional(Schema.String),
  kid: Schema.String,
  x5t: Schema.optional(Schema.String),
  n: Schema.String,
  e: Schema.String,
  alg: Schema.optional(Schema.String),
});
export type JsonWebKey = typeof JsonWebKey.Type;

export const JsonWebKeySet = Schema.Struct({
  keys: Schema.Array(JsonWebKey),
});
export type JsonWebKeySet = typeof JsonWebKeySet.Type;

export const JwtHeader = Schema.Struct({
  alg: Schema.String,
  kid: Schema.String,
  typ: Schema.optional(Schema.String),
});
export type JwtHeader = typeof JwtHeader.Type;

export const AzureJwtClaims = Schema.Struct({
  iss: Schema.String,
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  exp: Schema.Number,
  nbf: Schema.optional(Schema.Number),
  iat: Schema.optional(Schema.Number),
  tid: Schema.String,
  sub: Schema.String,
  oid: Schema.optional(Schema.String),
  upn: Schema.optional(Schema.String),
  preferred_username: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  nonce: Schema.optional(Schema.String),
  xms_edov: Schema.optional(Schema.Boolean),
});
export type AzureJwtClaims = typeof AzureJwtClaims.Type;
