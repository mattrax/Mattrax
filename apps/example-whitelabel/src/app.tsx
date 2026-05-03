import { render } from "solid-js/web";
import type { ParentProps } from "solid-js";
import { Router, Route, A, useLocation } from "@solidjs/router";
import Devices from "./pages/Devices.tsx";
import DeviceDetail from "./pages/DeviceDetail.tsx";
import Applications from "./pages/Applications.tsx";

function Nav() {
  const location = useLocation();
  return (
    <nav>
      <span class="brand">Mattrax MDM</span>
      <A href="/" class={location.pathname === "/" ? "active" : ""}>Devices</A>
      <A href="/applications" class={location.pathname === "/applications" ? "active" : ""}>Applications</A>
    </nav>
  );
}

function Layout(props: ParentProps) {
  return (
    <>
      <Nav />
      <main>{props.children}</main>
    </>
  );
}

function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Devices} />
      <Route path="/devices/:udid" component={DeviceDetail} />
      <Route path="/applications" component={Applications} />
    </Router>
  );
}

const root = document.getElementById("root");
if (root) render(() => <App />, root);
