// Installs a persistent, synchronous `localStorage` backed by SQLite on native.
// On web the browser's localStorage is used.
import 'expo-sqlite/localStorage/install';

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings are a convenience; failing to persist must never break the app.
  }
}
