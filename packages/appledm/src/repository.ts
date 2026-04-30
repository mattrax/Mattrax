import { Context, Effect } from "effect";
import { type MdmCommand, MdmError } from "./schema.js";

export class AppleMdmRepository extends Context.Service<
  AppleMdmRepository,
  {
    readonly insertCommand: (command: MdmCommand) => Effect.Effect<void, MdmError>;
    readonly getPendingCommands: (deviceId: string) => Effect.Effect<MdmCommand[], MdmError>;
    readonly getNextPendingCommand: (deviceId: string) => Effect.Effect<MdmCommand | null, MdmError>;
    readonly updateCommandStatus: (id: string, status: MdmCommand["status"], detail?: string) => Effect.Effect<void, MdmError>;
    readonly storePushInfo: (
      deviceId: string,
      udid: string,
      pushToken: string,
      pushMagic: string,
      topic: string,
      channel: "device" | "user",
    ) => Effect.Effect<void, MdmError>;
    readonly getDevicePushInfo: (deviceId: string) => Effect.Effect<{
      pushToken: string;
      pushMagic: string;
      topic: string;
    } | null, MdmError>;
  }
>()("AppleMdmRepository") {}
