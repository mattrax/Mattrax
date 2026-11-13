import { Effect } from "effect";
import {
  deserializeSoapElement,
  serializeSoapElement,
  SyncML,
  type SyncML as SyncMLType,
} from "@mattrax/soap";
import type {
  WindowsManagementRequest,
  WindowsManagementResponse,
} from "@mattrax/management-backend";

export class SyncMLError {
  readonly _tag = "SyncMLError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

export const parseSyncML = (xml: string): Effect.Effect<SyncMLType, SyncMLError> =>
  deserializeSoapElement(xml, SyncML).pipe(
    Effect.mapError((cause) => new SyncMLError("Failed to parse SyncML", cause)),
  );

export const serializeSyncML = (message: SyncMLType): Effect.Effect<string, SyncMLError> =>
  serializeSoapElement(SyncML, message).pipe(
    Effect.mapError((cause) => new SyncMLError("Failed to serialize SyncML", cause)),
  );

export function toManagementRequest(message: SyncMLType): WindowsManagementRequest {
  return {
    sessionID: message.syncHdr.sessionID,
    msgID: message.syncHdr.msgID,
    source: message.syncHdr.source.locURI,
    target: message.syncHdr.target.locURI,
    statuses: [...(message.syncBody.status ?? [])],
    alerts: [...(message.syncBody.alert ?? [])],
  };
}

export function fromManagementResponse(
  request: SyncMLType,
  response: WindowsManagementResponse,
): SyncMLType {
  const inbound = [
    ...(request.syncBody.alert ?? []).map((command) => ({ command, cmd: "Alert" })),
    ...(request.syncBody.get ?? []).map((command) => ({ command, cmd: "Get" })),
    ...(request.syncBody.add ?? []).map((command) => ({ command, cmd: "Add" })),
    ...(request.syncBody.replace ?? []).map((command) => ({ command, cmd: "Replace" })),
    ...(request.syncBody.delete ?? []).map((command) => ({ command, cmd: "Delete" })),
    ...(request.syncBody.exec ?? []).map((command) => ({ command, cmd: "Exec" })),
  ];

  const acknowledgements = inbound.map(({ command, cmd }, index) => ({
    cmdID: String(1000 + index),
    msgRef: request.syncHdr.msgID,
    cmdRef: command.cmdID,
    cmd,
    data: "200",
  }));

  return {
    syncHdr: {
      verDTD: request.syncHdr.verDTD,
      verProto: request.syncHdr.verProto,
      sessionID: request.syncHdr.sessionID,
      // OMA-DM requires the response to reuse the request MsgID.
      msgID: request.syncHdr.msgID,
      target: { locURI: request.syncHdr.source.locURI },
      source: { locURI: request.syncHdr.target.locURI },
    },
    syncBody: {
      status: [
        { cmdID: "1", msgRef: request.syncHdr.msgID, cmdRef: "0", cmd: "SyncHdr", data: "200" },
        ...acknowledgements,
      ],
      get: response.commands
        .filter((c) => c.kind === "Get")
        .map((c) => ({ cmdID: c.cmdID, items: [{ target: { locURI: c.locURI ?? "" } }] })),
      replace: response.commands
        .filter((c) => c.kind === "Replace")
        .map((c) => ({
          cmdID: c.cmdID,
          items: [
            {
              target: { locURI: c.locURI ?? "" },
              ...(c.format ? { meta: { format: c.format, type: "text/plain" } } : {}),
              data: c.data,
            },
          ],
        })),
      exec: response.commands
        .filter((c) => c.kind === "Exec")
        .map((c) => ({
          cmdID: c.cmdID,
          items: [
            {
              target: { locURI: c.locURI ?? "" },
              ...(c.format ? { meta: { format: c.format, type: "text/plain" } } : {}),
              data: c.data,
            },
          ],
        })),
      final: {},
    },
  };
}
