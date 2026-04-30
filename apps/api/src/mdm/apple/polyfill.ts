import { Context, Effect, Layer } from "effect";
import {
  type AppleDevice,
  type Declaration,
  type MdmCommand,
  MdmError,
} from "./schema";
import { AppleMdmRepository } from "./repository";

export function translateDeclarationsToCommands(
  device: AppleDevice,
  declarations: Declaration[],
): MdmCommand[] {
  const now = new Date();
  const commands: MdmCommand[] = [];

  for (const decl of declarations) {
    switch (decl.type) {
      case "configuration": {
        commands.push({
          id: crypto.randomUUID(),
          deviceId: device.id,
          requestType: "InstallProfile",
          payload: decl.payload,
          status: "pending",
          priority: 5,
          createdAt: now,
        });
        break;
      }
      case "management": {
        const payload = decl.payload as Record<string, unknown>;
        if (payload.requestType === "InstallApplication" || payload.requestType === "ApplicationConfiguration") {
          commands.push({
            id: crypto.randomUUID(),
            deviceId: device.id,
            requestType: "InstallApplication",
            payload: decl.payload,
            status: "pending",
            priority: 5,
            createdAt: now,
          });
        }
        break;
      }
    }
  }

  return commands;
}

export class DeclarationPolyfill extends Context.Service<
  DeclarationPolyfill,
  {
    readonly reconcileDevice: (deviceId: string) => Effect.Effect<void, MdmError>;
  }
>()("DeclarationPolyfill") {}

export const DeclarationPolyfillLive = Layer.effect(
  DeclarationPolyfill,
  Effect.gen(function* () {
    const repo = yield* AppleMdmRepository;

    const reconcileDevice = (deviceId: string): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* repo.getDeviceById(deviceId);
        if (!device) return;
        if (device.supportsDdm) return;

        const declarations = yield* repo.getDeclarations();
        const commands = translateDeclarationsToCommands(device, declarations);
        for (const cmd of commands) {
          yield* repo.insertCommand(cmd);
        }
      });

    return DeclarationPolyfill.of({ reconcileDevice });
  }),
);
