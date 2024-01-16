import { action } from "@solidjs/router";
import { loginAction } from "./login.server";

const login = action(loginAction, "login");

export default function Page() {
  // TODO: Autocomplete attributes

  // TODO: Use Mattrax colors on this page

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

        {/* // TODO: Loading state */}
        <form
          action={login}
          method="post"
          class="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]"
        >
          {/* // TODO: Hook up proper login */}
          <input
            type="email"
            name="email"
            placeholder="oscar@otbeaumont.me"
            class="hidden"
          />
          <input
            type="password"
            name="password"
            placeholder="password"
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
        </form>
      </div>
    </div>
  );
}
