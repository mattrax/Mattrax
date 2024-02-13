// This amazing counter component was written by @Brendonovich

import { Accessor, createEffect, createSignal, JSX, onCleanup } from "solid-js";

function ease(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

interface Props {
  start?: number;
  value: number;
  duration: number;
  children: (value: Accessor<number>) => JSX.Element;
}

const Count = (props: Props) => {
  const [value, setValue] = createSignal(props.value);

  createEffect<number>((start: number) => {
    const end = props.value;

    if (end !== undefined) {
      const startTime = performance.now();
      let lastFrame: null | number = null;

      const tick = () => {
        lastFrame = requestAnimationFrame(() => {
          const now = performance.now();
          const t = Math.min((now - startTime) / props.duration, 1);

          if (t === 1) {
            setValue(end);
            lastFrame = null;
          } else {
            setValue(start + Math.round((end - start) * ease(t)));

            tick();
          }
        });
      };

      tick();

      onCleanup(() => {
        if (lastFrame !== null) cancelAnimationFrame(lastFrame);
      });

      return end;
    } else return start;
  }, props.start ?? 0);

  return props.children(value);
};

export default Count;
