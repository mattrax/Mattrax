import { Context, Layer } from "effect";

export declare namespace Env {
  export type Service = {
    readonly origin: string;
    readonly cloudAppleVendorCert?: string;
  };
}

export class Env extends Context.Service<Env, Env.Service>()("@mattrax/enterprise-core/Env") {
  static readonly layer = (config: {
    readonly origin: string;
    readonly cloudAppleVendorCert?: string;
  }): Layer.Layer<Env> => Layer.succeed(Env, Env.of(config));
}
