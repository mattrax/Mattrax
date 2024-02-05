import { Html } from "@react-email/html";
import { Button } from "@react-email/button";

export function DemoEmail(props: { url: string }) {
  return (
    <Html lang="en">
      <Button href={props.url}>Click me</Button>
    </Html>
  );
}
