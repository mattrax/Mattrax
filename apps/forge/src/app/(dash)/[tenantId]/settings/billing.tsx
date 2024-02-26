import { trpc } from "~/lib";

export default function Page() {
  const stripePortalUrl = trpc.tenant.billing.portalUrl.useMutation(() => ({
    onSuccess: async (url) => {
      window.open(url, "_self");

      // Make sure the button is disabled until the user is in the new tab
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  }));

  return (
    <div>
      <h1 class="text-2xl font-semibold">Billing</h1>
      <p class="mt-2 mb-3 text-gray-700 text-sm">
        Control billing settings for this tenant.
      </p>
      <div class="flex flex-col gap-4">
        <p class="mt-2 mb-3 text-gray-700 text-xl">
          While Mattrax is beta, it's free!
        </p>

        {/* <p>Devices: 0</p> */}
        {/* TODO: How much is owed and when it's due */}

        {/* <Button
          class="w-full"
          onClick={() => stripePortalUrl.mutate()}
          disabled={stripePortalUrl.isPending}
        >
          Go to Stipe
        </Button> */}
      </div>
    </div>
  );
}
