export default function Page() {
  return (
    <div class="flex flex-col">
      <h1>Internal Admin Dashboard</h1>
      {/* TODO: Typesafe URL */}
      <a href="/api/internal/authorisefrank" rel="external">
        Authorise Frank
      </a>
      <button
        onClick={() => {
          // TODO: Typesafe fetch
          fetch("/api/internal/setup", {
            method: "POST",
          })
            .then((res) => {
              if (!res.ok) throw new Error(res.statusText);
              return res.json();
            })
            .then((data) => alert("Success!"))
            .catch((data) => alert("Error!"));
        }}
      >
        Setup Intune Subscription
      </button>
    </div>
  );
}
