import { Data, Effect } from "effect";
import { deserializeSoapElement, serializeSoapElement } from "@mattrax/soap";
import { SyncML } from "./messages.js";
import type { SyncML as SyncMLType } from "./messages.js";
import type {
  WindowsManagementRequest,
  WindowsManagementResponse,
} from "@mattrax/management-backend";

export class SyncMLError extends Data.TaggedError("SyncMLError")<{
  message: string;
  cause?: unknown;
}> {}

export const parseSyncML = (xml: string): Effect.Effect<SyncMLType, SyncMLError> =>
  deserializeSoapElement(xml, SyncML).pipe(
    Effect.mapError((cause) => new SyncMLError({ message: "Failed to parse SyncML", cause })),
  );

export const serializeSyncML = (message: SyncMLType): Effect.Effect<string, SyncMLError> =>
  serializeSoapElement(SyncML, message).pipe(
    Effect.mapError((cause) => new SyncMLError({ message: "Failed to serialize SyncML", cause })),
  );

export function toManagementRequest(message: SyncMLType): WindowsManagementRequest {
  return {
    sessionID: message.syncHdr.sessionID,
    msgID: message.syncHdr.msgID,
    source: message.syncHdr.source.locURI,
    target: message.syncHdr.target.locURI,
    statuses: [...(message.syncBody.status ?? [])],
    alerts: [...(message.syncBody.alert ?? [])],
    results: [...(message.syncBody.results ?? [])],
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
              meta: c.format ? { format: c.format, type: "text/plain" } : undefined,
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
              meta: c.format ? { format: c.format, type: "text/plain" } : undefined,
              data: c.data,
            },
          ],
        })),
      // OMA-DM `Delete` removes the node (and its subtree) from the device's
      // management tree. It carries a target only: there is no value to send.
      delete: response.commands
        .filter((c) => c.kind === "Delete")
        .map((c) => ({
          cmdID: c.cmdID,
          items: [{ target: { locURI: c.locURI ?? "" } }],
        })),
      final: {},
    },
  };
}
