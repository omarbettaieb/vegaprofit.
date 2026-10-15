// Shared string-literal types. These match the Prisma enums in prisma/schema.prisma by name,
// so values can be passed to Prisma without conversion. Pure modules in app/lib must not import
// @prisma/client (they are unit-tested with plain Node, see `npm test`).

export type Lifecycle =
  | "PLACED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURNED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export type AttributionMethod = "ID" | "NAME_MAP" | "URL_PARSE" | "NONE";

// Global dashboard switch: gross = everything not reversed, net = only delivered money.
export type View = "gross" | "net";
