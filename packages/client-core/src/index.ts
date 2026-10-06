export type ClientPlatform = "WEB" | "WINDOWS" | "MACOS" | "ANDROID" | "IOS";

export type DeviceCapability =
  | "OFFLINE_TRANSACTIONS"
  | "CAMERA"
  | "BARCODE_SCANNER"
  | "RECEIPT_PRINTER"
  | "CASH_DRAWER"
  | "LOCAL_FILE_EXPORT"
  | "PUSH_NOTIFICATIONS"
  | "BIOMETRIC_UNLOCK"
  | "BACKGROUND_SYNC";

export interface PlatformProfile {
  platform: ClientPlatform;
  capabilities: ReadonlySet<DeviceCapability>;
}

export interface ClientIdentity {
  deviceId: string;
  appVersion: string;
  platform: ClientPlatform;
  installationId: string;
}

export interface TenantContext {
  businessId: string;
  branchId: string;
  staffId: string;
  currencyCode: string;
  timezone: string;
}

export interface ClientSession {
  identity: ClientIdentity;
  tenant: TenantContext;
  accessToken: string;
}

export interface QueuedMutation<TPayload = unknown> {
  clientId: string;
  clientMutationId: string;
  businessId: string;
  branchId?: string;
  mutationType: string;
  occurredAt: string;
  payload: TPayload;
}

export interface MutationQueueStore {
  enqueue(mutation: QueuedMutation): Promise<void>;
  peek(limit: number): Promise<QueuedMutation[]>;
  remove(clientMutationIds: string[]): Promise<void>;
  markRejected(clientMutationId: string, reason: string): Promise<void>;
  countPending(): Promise<number>;
}

/**
 * Platform capability declarations are intentionally explicit. Shared business rules
 * must never assume a device feature exists merely because another TradeOS client has it.
 */
export function defaultPlatformProfile(platform: ClientPlatform): PlatformProfile {
  const common: DeviceCapability[] = ["OFFLINE_TRANSACTIONS"];

  switch (platform) {
    case "WEB":
      return profile(platform, [...common, "CAMERA", "BARCODE_SCANNER"]);
    case "WINDOWS":
    case "MACOS":
      return profile(platform, [
        ...common,
        "CAMERA",
        "BARCODE_SCANNER",
        "RECEIPT_PRINTER",
        "CASH_DRAWER",
        "LOCAL_FILE_EXPORT",
        "BACKGROUND_SYNC",
      ]);
    case "ANDROID":
    case "IOS":
      return profile(platform, [
        ...common,
        "CAMERA",
        "BARCODE_SCANNER",
        "PUSH_NOTIFICATIONS",
        "BIOMETRIC_UNLOCK",
        "BACKGROUND_SYNC",
      ]);
  }
}

export function supports(profile: PlatformProfile, capability: DeviceCapability): boolean {
  return profile.capabilities.has(capability);
}

function profile(platform: ClientPlatform, capabilities: DeviceCapability[]): PlatformProfile {
  return { platform, capabilities: new Set(capabilities) };
}
