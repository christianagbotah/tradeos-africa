import { generateUuid } from "./offline-sync";

export const WEB_APP_VERSION = "0.0.1";
const WEB_DEVICE_KEY_STORAGE = "tradeos.web.deviceKey.v1";

export function getOrCreateWebDeviceKey(): string {
  if (typeof window === "undefined") return "web-ssr";
  try {
    let key = window.localStorage.getItem(WEB_DEVICE_KEY_STORAGE);
    if (!key) {
      key = generateUuid();
      window.localStorage.setItem(WEB_DEVICE_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return generateUuid();
  }
}
