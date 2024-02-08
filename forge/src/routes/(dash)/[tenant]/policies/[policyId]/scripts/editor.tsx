import { onMount } from "solid-js";
import { CodeJar } from "codejar";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prism-themes/themes/prism-one-light.css";

// TODO: Command + / for uncomment working
// TODO: Line numbers

export default function Page() {
  let ref!: HTMLDivElement;

  onMount(() => {
    const jar = CodeJar(ref, (e) => Prism.highlightElement(e), {
      tab: "\t",
    });

    // TODO: Get this from the backend
    jar.updateCode(
      "#!/bin/bash\n\n# Your script here\n\n# Example\n# echo 'Hello, world!'\n"
    );
  });

  return (
    <code
      ref={ref}
      class="bg-[#fff] drop-shadow-md rounded-md text-sm font-normal !p-2 language-bash"
    />
  );
}
