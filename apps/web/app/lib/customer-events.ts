"use client";

export const customersChangedEvent = "tradeos:customers-changed";

export function notifyCustomersChanged(): void {
  window.dispatchEvent(new CustomEvent(customersChangedEvent));
}
