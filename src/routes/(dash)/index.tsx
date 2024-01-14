import { cache, createAsync, redirect } from "@solidjs/router";
import { getServerSession } from "~/server/session";
import { getDeviceConfigurations, getDevices } from "~/server/microsoft";

const demoAction = async (name: string) => {
  "use server";

  return `Hello, ${name}`;
};

const getInfo = async () => {
  "use server";

  const [devices, policies] = await Promise.allSettled([
    getDevices(),
    getDeviceConfigurations(),
  ]);

  try {
    return JSON.stringify({
      devices,
      policies,
    });
  } catch (err) {
    return `Error: ${(err as any).toString()}`;
  }
};

const getName = cache(async () => {
  "use server";

  const session = await getServerSession();
  if (!session.data.email) throw redirect("/login");
  return session.data.email;
}, "getName");

export const route = {
  load: () => getName(),
};

export default function Page() {
  const devices: { id: string; name: string }[] = []; // TODO: Get from Microsoft

  const name = createAsync(getName);

  // TODO: Render tenant ID + Select default one

  return (
    <main class="text-center mx-auto text-gray-700 p-4 flex flex-col">
      <h1>{name()}</h1>

      <button onClick={() => alert("todo")}>Enroll</button>

      <button onClick={() => demoAction("Oscar").then(console.log)}>
        Demo
      </button>

      <button onClick={() => getInfo().then((d) => console.log(JSON.parse(d)))}>
        Fetch Data
      </button>

      <a href="/profile.mobileconfig" rel="external">
        Enroll Profile
      </a>
    </main>
  );
}
