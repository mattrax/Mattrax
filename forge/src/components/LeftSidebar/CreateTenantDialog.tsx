// TODO: Use form abstraction
// TODO: Make this no look like shit
// TODO: Proper loading state

import { client } from "~/utils";

export function CreateTenantDialog() {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        client.api.tenants.create
          .$post({
            json: {
              name: formData.get("name") as any,
            },
          })
          .then((resp) => {
            if (resp.ok) location.reload(); // TODO: Properly invalidate data/update the cache
            // TODO: Close dialog
          });
      }}
      method="post"
    >
      <input type="text" name="name" placeholder="Tenant name" />
      <input type="submit" value="Create" />
    </form>
  );
}
