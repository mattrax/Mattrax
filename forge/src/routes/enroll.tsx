// TODO: Prerender this flow
// TODO: Make this flow work without JS

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
          // TODO: Deal with response errors
          fetch("/api/enrollment/apple", {
            method: "POST",
            body: JSON.stringify({
              data: ref.value,
            }),
          })
            .then((res) => {
              if (!res.ok) alert("Error");
              return res.json();
            })
            .then((data) => {
              if (!data.value) throw new Error("No value"); // TODO: How is this possible?
              download(
                base64Decode(data.value),
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

function download(content: Uint8Array, type: string, filename: string) {
  const a = document.createElement("a");
  const blob = new Blob([content], {
    type: "application/octet-stream",
  });
  a.href = window.URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// The implementation of this function was taken from Intune's minified code
// It's required for the code signing data to not get corrupted
function base64Decode(encoded: string) {
  for (
    var n = window.atob(encoded), r = n.length, o = new Uint8Array(r), i = 0;
    i < r;
    i++
  )
    o[i] = n.charCodeAt(i);
  return o;
}
