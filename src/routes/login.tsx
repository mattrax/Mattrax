import { action } from "@solidjs/router";
import { loginAction } from "./_login";

const login = action(loginAction, "login");

export default function Page() {
  // TODO: Autocomplete attributes

  return (
    <>
      <h1>Login</h1>
      <form action={login} method="post">
        <input type="email" name="email" placeholder="user@example.com" />
        <input type="password" name="password" placeholder="password" />
        <button type="submit">Login</button>
      </form>
    </>
  );
}
