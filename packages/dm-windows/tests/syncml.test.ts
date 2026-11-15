import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { SyncML } from "@mattrax/soap";
import { fromManagementResponse, serializeSyncML } from "../src/syncml.js";

const request: SyncML = {
  syncHdr: {
    verDTD: "1.2",
    verProto: "DM/1.2",
    sessionID: "1",
    msgID: "1",
    target: { locURI: "https://test.mattrax.app/mdm/windows/management" },
    source: { locURI: "device-1" },
  },
  syncBody: {},
};

const syncBody = (response: SyncML) => response.syncBody;

describe("Windows SyncML policy encoding", () => {
  it("encodes a Delete with its target and no data", () => {
    const response = fromManagementResponse(request, {
      commands: [
        {
          kind: "Delete",
          cmdID: "winp-d-1",
          locURI: "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage",
        },
      ],
    });

    expect(syncBody(response).delete).toEqual([
      {
        cmdID: "winp-d-1",
        items: [
          {
            target: {
              locURI: "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage",
            },
          },
        ],
      },
    ]);
  });

  it("serialises Replace, Get, Exec and Delete together", async () => {
    const response = fromManagementResponse(request, {
      commands: [
        { kind: "Replace", cmdID: "r1", locURI: "urn:replace", data: "1", format: "int" },
        { kind: "Delete", cmdID: "d1", locURI: "urn:delete" },
        { kind: "Get", cmdID: "g1", locURI: "urn:get" },
        { kind: "Exec", cmdID: "e1", locURI: "urn:exec", data: "", format: "chr" },
      ],
    });

    expect(syncBody(response).replace).toHaveLength(1);
    expect(syncBody(response).get).toHaveLength(1);
    expect(syncBody(response).exec).toHaveLength(1);
    expect(syncBody(response).delete).toHaveLength(1);

    const xml = await Effect.runPromise(serializeSyncML(response));

    expect(xml).toContain("<Delete>");
    expect(xml).toContain("<LocURI>urn:delete</LocURI>");
  });

  it("acknowledges an inbound Delete even when the server sends none", () => {
    const response = fromManagementResponse(
      {
        ...request,
        syncBody: {
          delete: [
            {
              cmdID: "3",
              items: [{ target: { locURI: "urn:device-delete" } }],
            },
          ],
        },
      },
      { commands: [] },
    );

    expect(syncBody(response).delete).toEqual([]);
    expect(
      (syncBody(response).status ?? []).some(
        (status: { cmdRef?: string; cmd?: string }) =>
          status.cmdRef === "3" && status.cmd === "Delete",
      ),
    ).toBe(true);
  });
});
