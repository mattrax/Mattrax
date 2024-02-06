import { JSX } from "solid-js";

// TODO: Setup unplugin icons
function PhLaptop(props: JSX.IntrinsicElements["svg"], key: string) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      {...props}
    >
      <path
        fill="currentColor"
        d="M232 168h-8V72a24 24 0 0 0-24-24H56a24 24 0 0 0-24 24v96h-8a8 8 0 0 0-8 8v16a24 24 0 0 0 24 24h176a24 24 0 0 0 24-24v-16a8 8 0 0 0-8-8M48 72a8 8 0 0 1 8-8h144a8 8 0 0 1 8 8v96H48Zm176 120a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8v-8h192ZM152 88a8 8 0 0 1-8 8h-32a8 8 0 0 1 0-16h32a8 8 0 0 1 8 8"
      ></path>
    </svg>
  );
}

function PhGear(props: JSX.IntrinsicElements["svg"], key: string) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      {...props}
    >
      <path
        fill="currentColor"
        d="M128 80a48 48 0 1 0 48 48a48.05 48.05 0 0 0-48-48m0 80a32 32 0 1 1 32-32a32 32 0 0 1-32 32m88-29.84q.06-2.16 0-4.32l14.92-18.64a8 8 0 0 0 1.48-7.06a107.21 107.21 0 0 0-10.88-26.25a8 8 0 0 0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186 40.54a8 8 0 0 0-3.94-6a107.71 107.71 0 0 0-26.25-10.87a8 8 0 0 0-7.06 1.49L130.16 40h-4.32L107.2 25.11a8 8 0 0 0-7.06-1.48a107.6 107.6 0 0 0-26.25 10.88a8 8 0 0 0-3.93 6l-2.64 23.76q-1.56 1.49-3 3L40.54 70a8 8 0 0 0-6 3.94a107.71 107.71 0 0 0-10.87 26.25a8 8 0 0 0 1.49 7.06L40 125.84v4.32L25.11 148.8a8 8 0 0 0-1.48 7.06a107.21 107.21 0 0 0 10.88 26.25a8 8 0 0 0 6 3.93l23.72 2.64q1.49 1.56 3 3L70 215.46a8 8 0 0 0 3.94 6a107.71 107.71 0 0 0 26.25 10.87a8 8 0 0 0 7.06-1.49L125.84 216q2.16.06 4.32 0l18.64 14.92a8 8 0 0 0 7.06 1.48a107.21 107.21 0 0 0 26.25-10.88a8 8 0 0 0 3.93-6l2.64-23.72q1.56-1.48 3-3l23.78-2.8a8 8 0 0 0 6-3.94a107.71 107.71 0 0 0 10.87-26.25a8 8 0 0 0-1.49-7.06Zm-16.1-6.5a73.93 73.93 0 0 1 0 8.68a8 8 0 0 0 1.74 5.48l14.19 17.73a91.57 91.57 0 0 1-6.23 15l-22.6 2.56a8 8 0 0 0-5.1 2.64a74.11 74.11 0 0 1-6.14 6.14a8 8 0 0 0-2.64 5.1l-2.51 22.58a91.32 91.32 0 0 1-15 6.23l-17.74-14.19a8 8 0 0 0-5-1.75h-.48a73.93 73.93 0 0 1-8.68 0a8 8 0 0 0-5.48 1.74l-17.78 14.2a91.57 91.57 0 0 1-15-6.23L82.89 187a8 8 0 0 0-2.64-5.1a74.11 74.11 0 0 1-6.14-6.14a8 8 0 0 0-5.1-2.64l-22.58-2.52a91.32 91.32 0 0 1-6.23-15l14.19-17.74a8 8 0 0 0 1.74-5.48a73.93 73.93 0 0 1 0-8.68a8 8 0 0 0-1.74-5.48L40.2 100.45a91.57 91.57 0 0 1 6.23-15L69 82.89a8 8 0 0 0 5.1-2.64a74.11 74.11 0 0 1 6.14-6.14A8 8 0 0 0 82.89 69l2.51-22.57a91.32 91.32 0 0 1 15-6.23l17.74 14.19a8 8 0 0 0 5.48 1.74a73.93 73.93 0 0 1 8.68 0a8 8 0 0 0 5.48-1.74l17.77-14.19a91.57 91.57 0 0 1 15 6.23L173.11 69a8 8 0 0 0 2.64 5.1a74.11 74.11 0 0 1 6.14 6.14a8 8 0 0 0 5.1 2.64l22.58 2.51a91.32 91.32 0 0 1 6.23 15l-14.19 17.74a8 8 0 0 0-1.74 5.53Z"
      ></path>
    </svg>
  );
}

export default function Page() {
  return (
    <main>
      <div class="mt-32 sm:mt-56">
        <div class="mx-auto max-w-7xl px-6 lg:px-8">
          <div class="mx-auto max-w-3xl sm:text-center">
            <h2 class="text-base font-medium leading-7 text-[#0284C8]">
              All your devices, one dashboard
            </h2>
            <p class="mt-2 text-6xl font-bold tracking-tight text-gray-900 sm:text-7xl">
              Mattrax MDM
            </p>
            <p class="mt-6 text-2xl font-medium leading-7 text-[#0284C8]">
              Launching alpha in mid-2024
            </p>
            <p class="mt-6 text-xl leading-8 text-gray-600">
              Mattrax MDM is a full device management solution with the ability
              to managed your organisations entire fleet from a single,
              well-crafted dashboard.
            </p>

            <h5 class="pt-8 text-2xl font-semibold leading-7 text-center">
              Features
            </h5>
            <ul role="list" class="flex flex-col space-y-4 pt-4">
              <li class="flex padding-4 justify-center items-center">
                <PhLaptop class="w-10 h-10" />
                <h4 class="pl-2 font-semibold">
                  One dashboard, all devices, no matter the OS
                </h4>
              </li>
              <li class="flex padding-4 justify-center items-center">
                <PhGear class="w-10 h-10" />
                <h4 class="pl-2 font-semibold">
                  Define your policy once, deploy it to any OS
                  {/* TODO: This is to line up the icons. Do this properly, cause this is cursed lol */}
                  &nbsp;
                </h4>
              </li>
            </ul>
          </div>
        </div>
        <div class="relative overflow-hidden pt-10">
          <div class="mx-auto max-w-7xl px-6 lg:px-8">
            <img
              src="/dashboard.png"
              alt="Mattrax Dashboard"
              class="mb-[-12%] rounded-xl shadow-2xl ring-1 ring-gray-900/10"
              width={2432}
              height={1442}
            />
            <div class="relative" aria-hidden="true">
              <div class="absolute -inset-x-20 bottom-0 bg-gradient-to-t from-white pt-[7%]" />
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-center items-center pt-4">
        <p>
          Developed by{" "}
          <a href="/company" class="text-center w-full underline">
            Mattrax Technologies Inc.
          </a>
        </p>
      </div>
    </main>
  );
}
