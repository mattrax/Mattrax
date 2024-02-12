import { useNavigate } from "@solidjs/router";
import { trpc } from "~/lib";

// TODO: Use form abstraction
// TODO: Autocomplete attributes
// TODO: Use Mattrax colors on this page

export default function Page() {
  const navigate = useNavigate();
  const mutation = trpc.auth.login.useMutation(() => ({
    onSuccess: () => navigate("/"),
  }));

  return (
    <div class="w-full h-full">
      <div class="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center">
          <h2 class="mt-6 text-center text-2xl font-bold leading-9 tracking-tight text-gray-900">
            Forge
          </h2>
          <span class="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
            Alpha
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            mutation.mutate({
              email: formData.get("email") as any,
              password: formData.get("password") as any,
            });
          }}
        >
          <fieldset
            class="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]"
            disabled={mutation.isPending}
          >
            {/* // TODO: Hook up proper login */}
            <input
              type="email"
              name="email"
              placeholder="oscar@otbeaumont.me"
              value="oscar@otbeaumont.me"
              class="hidden"
            />
            <input
              type="password"
              name="password"
              placeholder="password"
              value="password"
              class="hidden"
            />

            <div class="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12">
              <button
                type="submit"
                class="flex w-full items-center justify-center gap-3 rounded-md bg-[#24292F] hover:bg-[#24292F]/90 px-3 py-1.5 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24292F]"
              >
                <span class="text-sm font-semibold leading-6">Login</span>
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
