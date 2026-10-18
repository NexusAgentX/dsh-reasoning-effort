/** JSON-shaped settings views shared by the Host projection and browser page. */

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject { [key: string]: JsonValue }

/** One settings entry as consumed by the client projection. */
export interface ReasoningNamespaceDocument {
  ns: string
  revision: number
  value: JsonObject
  user: JsonObject
}

/** Consistent settings cut used for editing and revision-fenced writes. */
export interface ReasoningSettingsDocument {
  writable: boolean
  namespaces: ReasoningNamespaceDocument[]
}

export type ReasoningPathOp =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }
