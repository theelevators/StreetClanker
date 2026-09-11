import { event } from "mob3";
import type { AssetFailedEvent, AssetReadyEvent } from "./types.js";

export const AssetReady = event<AssetReadyEvent>("AssetReady");
export const AssetFailed = event<AssetFailedEvent>("AssetFailed");
