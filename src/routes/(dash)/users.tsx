import { useSession } from "~/server/session";

export default function Page() {
  const session = useSession();
  return <h1 class="m-2">Hello, {session.session.name}.</h1>;
}
