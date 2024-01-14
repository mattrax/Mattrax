import { cache, createAsync } from "@solidjs/router";
import { For } from "solid-js";
import { getSession } from "~/server/session";
import { Client } from "@microsoft/microsoft-graph-client";
import {
  TokenCredentialAuthenticationProvider,
  TokenCredentialAuthenticationProviderOptions,
} from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { env } from "~/env";
import { ClientSecretCredential } from "@azure/identity";

const demo = async (deviceId: string) => {
  "use server";

  const tokenCredential = new ClientSecretCredential(
    env.MSFT_ADMIN_TENANT,
    env.MSFT_CLIENT_ID,
    env.MSFT_CLIENT_SECRET
  );

  const client = Client.initWithMiddleware({
    debugLogging: true,
    authProvider: new TokenCredentialAuthenticationProvider(tokenCredential, {
      scopes: ["https://graph.microsoft.com/.default"],
      getTokenOptions: {},
    }),
  });

  try {
    let userDetails = await client.api("/me").get();
    console.log(userDetails);

    return "Hello From The Server!";
  } catch (error) {
    console.error(error);
    return error.toString();
  }
};

// TODO: Proper input validation using Valibot
const toggleProfileOnDevice = async (deviceId: string) => {
  "use server";

  console.log(deviceId);

  return "Hello From The Server!";
};

const getName = cache(async () => {
  "use server";

  try {
    const session = await getSession();
    return session?.data?.email ?? "Not authenticated";
  } catch (err) {
    return "Error";
  }
}, "getName");

export const route = {
  load: () => getName(),
};

export default function Home() {
  const devices: { id: string; name: string }[] = []; // TODO: Get from Microsoft

  const name = createAsync(getName);

  return (
    <main class="text-center mx-auto text-gray-700 p-4 flex flex-col">
      <h1>{name()}</h1>

      <button onClick={() => alert("todo")}>Enroll</button>

      <For each={devices}>
        {(device) => (
          <div>
            <h1>{device.name}</h1>
            <button onClick={() => alert("todo")}>Sync</button>
            <button onClick={() => toggleProfileOnDevice("todo")}>
              Toggle restriction
            </button>
            <button onClick={() => alert("todo")}>Unenroll</button>
          </div>
        )}
      </For>

      <button onClick={() => demo("hello").then(console.log)}>
        Test Server Actions
      </button>

      <a href="/profile.mobileconfig">Enroll Profile</a>
    </main>
  );
}
