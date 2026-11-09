import { Meta, Title } from "@solidjs/meta";
import { useParams, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createSignal, Match, Show, Switch } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, type EnrollmentResponse, type PlatformEnrollment } from "~/lib/enterprise";

export default function EnrollPage() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const searchCode = () => (Array.isArray(search.code) ? search.code[0] : search.code);
  const [code, setCode] = createSignal(searchCode() ?? "");
  const enrollment = useQuery(() => ({
    queryKey: ["enterprise", "public-enrollment", params.id, searchCode()],
    queryFn: () => enterprise.getEnrollment(params.id, searchCode()),
    retry: false,
  }));

  const submitCode = (event: SubmitEvent) => {
    event.preventDefault();
    setSearch({ code: code() });
  };

  return (
    <main class="min-h-svh bg-stone-950 px-4 py-10 text-stone-950">
      <Title>Enroll in Mattrax</Title>
      <Meta name="robots" content="noindex" />
      <div class="mx-auto flex min-h-[calc(100svh-5rem)] max-w-md items-center">
        <Card class="w-full bg-white">
          <CardHeader class="text-center">
            <CardTitle>Enroll in Mattrax</CardTitle>
            <CardDescription>
              <Show when={enrollment.data} fallback="Verifying enrollment link...">
                {(data) => (
                  <>
                    Enroll a device into{" "}
                    <span class="font-medium text-stone-900">{data().name}</span>.
                  </>
                )}
              </Show>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Show when={enrollment.isError}>
              <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                This enrollment link is invalid or unavailable. Contact your administrator.
              </div>
            </Show>

            <Show when={enrollment.data?.authenticated === false}>
              <form class="space-y-3" onSubmit={submitCode}>
                <p class="text-sm text-muted-foreground">
                  Your administrator has set an enrollment password.
                </p>
                <Input
                  value={code()}
                  onInput={(event) => setCode(event.currentTarget.value)}
                  placeholder="Enrollment password"
                  autofocus
                />
                <Button type="submit" class="w-full">
                  Continue
                </Button>
                <Show when={searchCode()}>
                  <p class="text-center text-sm text-red-600">
                    The enrollment password is invalid.
                  </p>
                </Show>
              </form>
            </Show>

            <Show when={enrollment.data?.authenticated === true}>
              <EnrollmentOptions
                enrollment={enrollment.data as Extract<EnrollmentResponse, { authenticated: true }>}
                id={params.id}
              />
            </Show>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function EnrollmentOptions(props: {
  id: string | undefined;
  enrollment: Extract<EnrollmentResponse, { authenticated: true }>;
}) {
  const [tab, setTab] = createSignal<"apple" | "windows" | "android">("apple");
  return (
    <div class="space-y-4">
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1">
        <TabButton active={tab() === "apple"} onClick={() => setTab("apple")}>
          Apple
        </TabButton>
        <TabButton active={tab() === "windows"} onClick={() => setTab("windows")}>
          Windows
        </TabButton>
        <TabButton active={tab() === "android"} onClick={() => setTab("android")}>
          Android
        </TabButton>
      </div>
      <Switch>
        <Match when={tab() === "apple"}>
          <ApplePane apple={props.enrollment.apple} />
        </Match>
        <Match when={tab() === "windows"}>
          <AvailabilityPane value={props.enrollment.windows} label="Windows enrollment" />
        </Match>
        <Match when={tab() === "android"}>
          <AndroidPane id={props.id} android={props.enrollment.android} />
        </Match>
      </Switch>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={
        props.active
          ? "rounded-md bg-white px-3 py-2 text-sm font-medium shadow-sm"
          : "rounded-md px-3 py-2 text-sm text-stone-600"
      }
    >
      {props.children}
    </button>
  );
}

function ApplePane(props: { apple: PlatformEnrollment }) {
  if (typeof props.apple === "object" && "error" in props.apple)
    return <p class="text-center text-sm text-red-600">{props.apple.error}</p>;
  if (typeof props.apple !== "object" || !("profile" in props.apple))
    return (
      <p class="text-center text-sm text-muted-foreground">Apple enrollment is unavailable.</p>
    );
  const profile = props.apple.profile;
  const download = () => {
    const link = document.createElement("a");
    link.href = `data:application/x-apple-aspen-config;base64,${profile}`;
    link.download = "enroll.mobileconfig";
    link.click();
  };
  return (
    <div class="space-y-4">
      <Button class="w-full" onClick={download}>
        Download mobileconfig
      </Button>
      <p class="text-center text-sm text-muted-foreground">
        Open the downloaded file, then follow the instructions in System Settings &gt; General &gt;
        Device Management.
      </p>
    </div>
  );
}

function AvailabilityPane(props: { value: PlatformEnrollment; label: string }) {
  if (typeof props.value === "object" && "error" in props.value)
    return <p class="text-center text-sm text-red-600">{props.value.error}</p>;
  return (
    <p class="text-center text-sm text-muted-foreground">
      {props.label} is available. Follow your administrator's platform-specific instructions.
    </p>
  );
}

function AndroidPane(props: { id: string | undefined; android: PlatformEnrollment }) {
  if (typeof props.android === "object" && "error" in props.android)
    return <p class="text-center text-sm text-red-600">{props.android.error}</p>;
  return (
    <div class="space-y-3 text-center text-sm text-muted-foreground">
      <p>
        Scan the QR code with Android Device Policy or open the setup link on the Android device.
      </p>
      <Button
        as="a"
        href={`/api/v1/enrollment/${encodeURIComponent(props.id ?? "")}/android/link`}
        variant="outline"
      >
        Open Android setup link
      </Button>
    </div>
  );
}
