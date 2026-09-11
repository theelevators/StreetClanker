import { component } from "./component.js";

/** Optional diagnostic/application name — not entity identity. */
export type NameData = {
  value: string;
};

export const Name = component<NameData>({ value: "" }, "Name");
