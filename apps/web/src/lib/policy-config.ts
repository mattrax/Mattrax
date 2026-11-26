import { Option, Schema } from "effect";

export const PolicyConfiguration = Schema.Record(Schema.String, Schema.Json);

export type PolicyConfiguration = typeof PolicyConfiguration.Type;

export const decodePolicyConfiguration = Schema.decodeUnknownOption(PolicyConfiguration);

export const decodePolicyConfigurationOrEmpty = (value: unknown): PolicyConfiguration =>
  Option.getOrUndefined(decodePolicyConfiguration(value)) ?? {};
