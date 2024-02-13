import { createContext, createSignal, useContext } from "solid-js";

const context = createContext<ReturnType<typeof createController>>();

export const ControllerProvider = context.Provider;

export function createController() {
  const [open, setOpen] = createSignal(false);

  return {
    open,
    setOpen,
  };
}

export function useController() {
  const ctx = useContext(context);
  if (!ctx) throw new Error("'useController' must be used within a Dialog");
  return ctx;
}

export type Controller = ReturnType<typeof createController>;
