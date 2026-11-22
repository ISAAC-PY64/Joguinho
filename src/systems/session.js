import { uid } from "./game.js";

export function getDeviceId() {
  const key = "monster-haven-device-id";
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    deviceId = uid();
    localStorage.setItem(key, deviceId);
  }
  return deviceId;
}

export function getSessionToken(playerId) {
  const key = `monster-haven-session-${playerId}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = uid();
    localStorage.setItem(key, token);
  }
  return token;
}
