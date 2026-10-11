/**
 * usePlatformProfile — resolves the runtime platform + capability profile via
 * @tradeos/client-core. Used by the Sidebar (platform indicator) and the POS
 * (peripheral-aware UI: printer, scanner, cash drawer).
 */
import { useMemo } from "react";
import {
  defaultPlatformProfile,
  supports,
  type DeviceCapability,
  type PlatformProfile,
} from "@tradeos/client-core";
import { detectPlatform } from "../lib/tauri-api.js";
import type { ClientPlatform } from "@tradeos/client-core";

export interface PlatformProfileState {
  platform: ClientPlatform;
  profile: PlatformProfile;
  isTauri: boolean;
  has: (capability: DeviceCapability) => boolean;
}

export function usePlatformProfile(): PlatformProfileState {
  return useMemo(() => {
    const platform = detectPlatform();
    const profile = defaultPlatformProfile(platform);
    // detectPlatform already returns a ClientPlatform; the Tauri runtime flag
    // is the source of truth for "native window" affordances.
    const tauri =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    return {
      platform,
      profile,
      isTauri: tauri,
      has: (capability: DeviceCapability) => supports(profile, capability),
    };
  }, []);
}
