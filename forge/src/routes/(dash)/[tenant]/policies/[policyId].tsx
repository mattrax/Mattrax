import { cache, createAsync, redirect, useParams } from "@solidjs/router";
import { eq } from "drizzle-orm";
import { Suspense } from "solid-js";

import {
  db,
  policies,
  assignDeviceConfiguration,
  createDeviceConfiguration,
  getDeviceConfiguration,
  updateDeviceConfiguration,
  decodeId,
} from "@mattrax/api";
import { buildApplePolicy } from "@mattrax/policy";

const fetchPolicy = cache(async (policyId: string) => {
  "use server";

  // TODO: Check auth
  // TODO: Check user is authorised to access tenant which owns the device

  // const policy = await getDeviceConfiguration(policyId);

  // return {
  //   name: policy.displayName,
  // };

  const id = decodeId("policy", policyId);

  const policy = (
    await db.select().from(policies).where(eq(policies.id, id))
  )?.[0];
  if (!policy) {
    // TODO: Error handling
    return {
      name: "404 policy not found",
    };
  }

  return {
    name: policy.name,
    hasSyncedWithIntune: policy.intuneId !== null,
  };
}, "device");

const pushPolicyToIntune = async (policyId: string) => {
  "use server";

  // TODO: Check auth
  // TODO: Check user is authorised to policy

  const id = decodeId("policy", policyId);

  const policy = (
    await db.select().from(policies).where(eq(policies.id, id))
  )?.[0];
  if (!policy) {
    console.error("policy not found");
    return;
  }

  let policyBody: string;
  try {
    policyBody = buildApplePolicy(policy.policy);
  } catch (err) {
    console.error("ERROR BUILDING POLICY", err);
    return;
  }

  // TODO: Support Window's & Android policies

  if (!policy.intuneId) {
    console.log("CREATE ON INTUNE");

    // TODO: We probs need to create a Intune policy for each platform we wanna target

    try {
      const result = await createDeviceConfiguration({
        "@odata.context":
          "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
        "@odata.type": "#microsoft.graph.iosCustomConfiguration",
        displayName: policy.id.toString(),
        version: 1,
        payload: btoa(policyBody),
        payloadName: "todo",
      });
      console.log(result);

      await db
        .update(policies)
        .set({
          intuneId: result.id,
          intunePolicyHash: policy.policyHash,
        })
        .where(eq(policies.id, id));
    } catch (err) {
      console.error(err);
    }

    // TODO: Assign this back into the DB
  } else {
    console.log("UPDATE POLICY");

    const intunePolicy = await getDeviceConfiguration(policy.intuneId);

    // TODO: Check if the policy has actually changed

    try {
      const result = await updateDeviceConfiguration(policy.intuneId, {
        "@odata.context":
          "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
        "@odata.type": "#microsoft.graph.iosCustomConfiguration",
        displayName: policy.id.toString(),
        // version: intunePolicy.version! + 1,
        payload: btoa(policyBody),
        payloadName: "todo",
      });

      // TODO: If policy actually doesn't exist then just create it

      // console.log(result);
    } catch (err) {
      console.error(err);
    }
  }

  return undefined;
};

const tempAssignToEveryone = async (
  policyId: string,
  assignOrUnassigned: boolean
) => {
  "use server";
  // TODO: This assigns a policy to devices outside it's own tenant. That's bad!

  // TODO: Authentication
  // TODO: Authorisation to this tenant?

  const id = decodeId("policy", policyId);
  const policy = (
    await db.select().from(policies).where(eq(policies.id, id))
  )?.[0];
  if (!policy) throw new Error("Policy not found");

  if (!policy.intuneId) throw new Error("Policy not synced with Intune"); // TODO: Do this automatically in this case

  try {
    const assignments = assignOrUnassigned
      ? [
          {
            target: {
              "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget",
            },
          },
        ]
      : [];

    await assignDeviceConfiguration(policy.intuneId, {
      assignments,
    });
  } catch (err) {
    console.error(err);
  }
};

const updatePolicy = async (policyId: string, policyData: any[]) => {
  "use server";

  // TODO: Check auth
  // TODO: Check user is authorised to policy

  // TODO: Validate incoming `policy`

  const id = decodeId("policy", policyId);

  // TODO: Error if id is not found by catching error
  await db
    .update(policies)
    .set({
      policy: policyData,
    })
    .where(eq(policies.id, id));
};

export const route = {
  load: ({ params }) => fetchPolicy(params.policyId),
};

export default function Page() {
  const params = useParams();
  if (!params.policyId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const policy = createAsync(() => fetchPolicy(params.policyId));

  return (
    <div class="flex flex-col">
      <h1>Policy Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <h1>Name: {policy()?.name}</h1>
        <h1>
          Has Synced With Intune:{" "}
          {JSON.stringify(policy()?.hasSyncedWithIntune)}
        </h1>

        <h2>Configuration:</h2>
        <div class="flex">
          <p>Disable Camera:</p>

          <input
            checked={false}
            type="checkbox"
            onChange={(e) => {
              updatePolicy(params.policyId!, [
                {
                  camera: e.currentTarget.checked,
                },
              ]).then(() => alert("Updated!"));
            }}
          />
        </div>

        <h2>Intune:</h2>
        <button
          onClick={() => {
            pushPolicyToIntune(params.policyId!).then(() =>
              alert("Policy pushed!")
            );
          }}
        >
          Sync
        </button>

        <h2>Assign Devices</h2>
        <button
          onClick={() => {
            tempAssignToEveryone(params.policyId!, true).then(() => {
              alert("Assigned!");
            });
          }}
        >
          Assign
        </button>
        <button
          onClick={() => {
            tempAssignToEveryone(params.policyId!, false).then(() => {
              alert("Unassigned!");
            });
          }}
        >
          Unassign
        </button>
      </Suspense>
    </div>
  );
}
