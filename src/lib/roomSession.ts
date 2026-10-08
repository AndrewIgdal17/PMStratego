import type { Slot } from '../types.ts';

/** Default piece color. Opponent never sees this; it is local only. */
export const DEFAULT_PLAYER_COLOR = '#4a7a4a';

function roomKey(roomCode: string, field: 'token' | 'slot' | 'botToken' | 'color'): string {
  return `stratego:${roomCode}:${field}`;
}

export function saveRoomSession(roomCode: string, token: string, slot: Slot): void {
  localStorage.setItem(roomKey(roomCode, 'token'), token);
  localStorage.setItem(roomKey(roomCode, 'slot'), String(slot));
}

export function getRoomSession(roomCode: string): { token: string; slot: Slot } | null {
  const token = localStorage.getItem(roomKey(roomCode, 'token'));
  const slotRaw = localStorage.getItem(roomKey(roomCode, 'slot'));
  if (!token || (slotRaw !== '1' && slotRaw !== '2')) return null;
  return { token, slot: Number(slotRaw) as Slot };
}

export function getBotToken(roomCode: string): string | null {
  return localStorage.getItem(roomKey(roomCode, 'botToken'));
}

export function saveBotToken(roomCode: string, token: string): void {
  localStorage.setItem(roomKey(roomCode, 'botToken'), token);
}

/** Removes the seat token, slot, and bot token. Leaves the local army color. */
export function clearRoomSession(roomCode: string): void {
  localStorage.removeItem(roomKey(roomCode, 'token'));
  localStorage.removeItem(roomKey(roomCode, 'slot'));
  localStorage.removeItem(roomKey(roomCode, 'botToken'));
}

export function getPlayerColor(roomCode: string): string {
  return localStorage.getItem(roomKey(roomCode, 'color')) || DEFAULT_PLAYER_COLOR;
}

export function setPlayerColor(roomCode: string, hex: string): void {
  localStorage.setItem(roomKey(roomCode, 'color'), hex);
}
