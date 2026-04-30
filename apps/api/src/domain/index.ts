import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { version } from "../../package.json" with { type: "json" };

// HTTP API for the Mattrax UI & public API access
export const mattraxApi = HttpApi.make("MattraxApi")
//   .add(accountEndpoints)
//   .add(driveEndpoints)
//   .add(shareEndpoints)
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "OSDrive API",
      version,
      description: "OSDrive Web API",
      servers: [{ url: "/" }],
    }),
  );
