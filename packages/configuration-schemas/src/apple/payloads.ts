export type AppleProfilePayload = { title: string; description: string; properties: { [key in string]: Property }; supervised: boolean }
export type Property = { title?: string | null; description?: string | null; type: PropertyType }
export type PropertyType = { array: PropertyType[] } | "boolean" | "date" | "data" | { dictionary: { [key in string]: Property } } | "integer" | "real" | "float" | "string" | "url" | "alias" | "unionPolicy" | "plist"
