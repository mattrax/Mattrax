import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { SyncML } from "../src/messages.js";
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

  it("encodes an Add PFX blob with target, format and data", async () => {
    const response = fromManagementResponse(request, {
      commands: [
        {
          kind: "Add",
          cmdID: "pfx-1",
          locURI:
            "./Device/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/id-1/PFXCertBlob",
          data: "MIIBAgM=",
          format: "b64",
        },
      ],
    });

    expect(syncBody(response).add).toEqual([
      {
        cmdID: "pfx-1",
        items: [
          {
            target: {
              locURI:
                "./Device/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/id-1/PFXCertBlob",
            },
            meta: { format: "b64", type: "text/plain" },
            data: "MIIBAgM=",
          },
        ],
      },
    ]);

    const xml = await Effect.runPromise(serializeSyncML(response));

    expect(xml).toContain("<Add>");
    expect(xml).toContain("<LocURI>./Device/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/id-1/PFXCertBlob</LocURI>");
    expect(xml).toContain("MIIBAgM=");
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
