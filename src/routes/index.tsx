import { cache, createAsync } from "@solidjs/router";
import { For } from "solid-js";
import { getSession } from "~/server/session";
import { getDevices } from "~/server/microsoft";

const demoAction = async (name: string) => {
  "use server";

  return `Hello, ${name}`;
};

const getDevicesAction = async (deviceId: string) => {
  "use server";

  try {
    return JSON.stringify(await getDevices());
  } catch (err) {
    return `Error: ${(err as any).toString()}`;
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

      <button onClick={() => demoAction("Oscar").then(console.log)}>
        Demo
      </button>

      <button onClick={() => getDevicesAction("hello").then(console.log)}>
        Fetch Devices
      </button>

      <a href="/profile.mobileconfig" rel="external">
        Enroll Profile
      </a>
    </main>
  );
}
