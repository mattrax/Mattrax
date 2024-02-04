import {
  DragDropProvider,
  DragDropSensors,
  DragEventHandler,
  DragOverlay,
  Id,
  SortableProvider,
  closestCenter,
  createSortable,
  useDragDropContext,
} from "@thisbeyond/solid-dnd";
import { For, createSignal } from "solid-js";

// TODO: Break this out and have the declaration also define available properties to render
const typeToName = {
  unknown: "Unknown",
  restriction: "Restriction",
  wifi: "WiFi Connection",

  // TODO: Other configurations

  // TODO: Early returns
  // TODO: If statements
} as any; // TODO: Typescript

// TODO: Get from API
const mockData = [
  {
    id: "1",
    type: "restriction",
  },
  {
    id: "2",
    type: "wifi",
  },
];

// TODO: Fractional indexing
const PolicyBuilder = () => {
  const [configurations, setConfigurations] = createSignal(mockData);
  const [activeDragItem, setActiveDragItem] = createSignal<Id | null>(null);

  const onDragStart: DragEventHandler = ({ draggable }) =>
    setActiveDragItem(draggable.id);

  const onDragEnd: DragEventHandler = ({ draggable, droppable }) => {
    if (draggable && droppable) {
      const fromIndex = configurations().findIndex(
        (c) => c.id === draggable.id
      );
      const toIndex = configurations().findIndex((c) => c.id === droppable.id);
      if (fromIndex !== toIndex) {
        const updatedItems = configurations().slice();
        updatedItems.splice(toIndex, 0, ...updatedItems.splice(fromIndex, 1));
        setConfigurations(updatedItems);
      }
    }
  };

  return (
    <div class="p-4">
      <h1 class="text-2xl mt-8">Policy Builder:</h1>
      <DragDropProvider
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <div class="column self-stretch flex flex-col space-y-4">
          <SortableProvider ids={configurations().map((c) => c.id)}>
            <For each={configurations()}>
              {(config) => (
                <ConfigurationItem
                  config={config}
                  createConfiguration={() =>
                    setConfigurations([
                      ...configurations(),
                      { id: "3", type: "unknown" },
                    ])
                  }
                />
              )}
            </For>
          </SortableProvider>
        </div>
        <DragOverlay>
          {/* We put an invisible element under the cursor so we can customise the cursor appearance */}
          <div class="cursor-pointer w-10 h-10 translate-x-1/2"></div>
        </DragOverlay>
      </DragDropProvider>
    </div>
  );
};

function ConfigurationItem(props: {
  config: any;
  createConfiguration: () => {};
}) {
  const sortable = createSortable(props.config.id);
  const [state] = useDragDropContext();

  return (
    <div
      use:sortable
      class="w-full p-2 border-4 border-black rounded-md drop-shadow-md cursor-pointer"
      classList={{
        "opacity-25": sortable.isActiveDraggable,
        "transition-transform": !!state.active.draggable,
      }}
    >
      <h2 class="text-2xl">{typeToName[props.config.type]}</h2>

      {/* TODO: Allow configuring policy */}

      {/* TODO: Allow removing the configuration */}

      {/* TODO: Make this a dropdown to select the type??? */}
      {/* TODO: Only show this on last item */}
      <div
        class="bg-black w-12 h-6 absolute left-[50%] -translate-x-1/2"
        onClick={() => props.createConfiguration()}
      ></div>
    </div>
  );
}

export default PolicyBuilder;
