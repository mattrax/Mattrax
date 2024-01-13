import { For } from "solid-js";

const demo = async (deviceId: string) => {
  "use server";
  return "Hello From The Server!";
};

// TODO: Proper input validation using Valibot
const toggleProfileOnDevice = async (deviceId: string) => {
  "use server";

  console.log(deviceId);

  return "Hello From The Server!";
};

export default function Home() {
  const devices: { id: string; name: string }[] = []; // TODO: Get from Microsoft

  return (
    <main class="text-center mx-auto text-gray-700 p-4 flex flex-col">
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
    </main>
  );
}
