import { getDeviceConfigurations, getDevices } from "@mattrax/api";

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

export default function Page() {
  return (
    <main class="text-center mx-auto text-gray-700 p-4 flex flex-col">
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
