import * as React from "react"; // < required for JSX
import { Html } from "@react-email/html";
import { Button } from "@react-email/button";

export default function (props: { url: string }) {
  return (
    <Html lang="en">
      <Button href={props.url}>Click me</Button>
    </Html>
  );
}
