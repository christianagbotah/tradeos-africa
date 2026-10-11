import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  AsyncQueueSnapshotStorage,
  MobilePersistence,
  type SecureStringStorage,
  type StringStorage,
} from "./storage";

class NativePlainStorage implements StringStorage {
  getItem(key: string) { return AsyncStorage.getItem(key); }
  setItem(key: string, value: string) { return AsyncStorage.setItem(key, value); }
  removeItem(key: string) { return AsyncStorage.removeItem(key); }
}

class NativeSecureStorage implements SecureStringStorage {
  getItem(key: string) { return SecureStore.getItemAsync(key); }
  setItem(key: string, value: string) { return SecureStore.setItemAsync(key, value); }
  removeItem(key: string) { return SecureStore.deleteItemAsync(key); }
}

export function createNativeMobilePersistence(): MobilePersistence {
  return new MobilePersistence(new NativePlainStorage(), new NativeSecureStorage(), () => Crypto.randomUUID());
}

export function createNativeQueueStorage(): AsyncQueueSnapshotStorage {
  return new AsyncQueueSnapshotStorage(new NativePlainStorage());
}