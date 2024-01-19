import { cache, createAsync, redirect, useParams } from "@solidjs/router";
import { eq } from "drizzle-orm";
import { Suspense } from "solid-js";
import { db } from "~/server/db";
import { policies } from "~/server/db/schema";
import {
  createDeviceConfiguration,
  getDeviceConfiguration,
  updateDeviceConfiguration,
} from "~/server/microsoft";
import { decodeId } from "~/server/utils";
import { demoPolicy } from "./todoCameraPolicy";

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
        payload: btoa(demoPolicy),
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
        payload: btoa(demoPolicy),
        payloadName: "todo",
      });
      // console.log(result);
    } catch (err) {
      console.error(err);
    }
  }

  return undefined;
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
        <div>
          <p>Disable Camera:</p>

          <input checked={false} type="checkbox" />
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
        {/* TODO */}
      </Suspense>
    </div>
  );
}
