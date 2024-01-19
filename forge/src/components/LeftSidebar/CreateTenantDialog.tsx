// TODO: Use form abstraction
// TODO: Make this no look like shit
// TODO: Proper loading state

import { createTenant } from "./CreateTenantDialog.server";

export function CreateTenantDialog() {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        createTenant(new FormData(e.currentTarget)).then(() => {
          location.reload(); // TODO: Properly invalidate data/update the cache
        });
        // TODO: Close dialog
      }}
      method="post"
    >
      <input type="text" name="name" placeholder="Tenant name" />
      <input type="submit" value="Create" />
    </form>
  );
}
