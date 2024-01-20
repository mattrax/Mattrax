import { client } from "~/utils";

export default function Page() {
  let ref!: HTMLInputElement;

  // TODO: User authentication. Enter email and infer provider for tenant that owns them.

  // TODO: Detect OS and show the correct flow

  return (
    <div class="flex flex-col">
      <h1>Enroll in Management</h1>
      <input ref={ref} placeholder="some data" value="abc" />
      <button
        onClick={() => {
          // TODO: Deal with response
          client.api.devices.enroll.ios
            .$post({
              json: {
                data: ref.value,
              },
            })
            .then((res) => {
              if (!res.ok) alert("Error");
              return res.json();
            })
            .then((data) => {
              if (!data.value) throw new Error("No value"); // TODO: How is this possible?
              download(
                data.value,
                "application/octet-stream",
                "enroll.mobileconfig"
              );
            });
        }}
      >
        Enroll
      </button>
    </div>
  );
}

function download(content: string, type: string, filename: string) {
  const a = document.createElement("a");
  const blob = new Blob([content], {
    type: "application/octet-stream",
  });
  a.href = window.URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
