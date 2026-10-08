/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_COLOR,
  clearRoomSession,
  getBotToken,
  getPlayerColor,
  getRoomSession,
  saveBotToken,
  saveRoomSession,
  setPlayerColor,
} from './roomSession.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('roomSession', () => {
  it('stores and reads the seat token and slot', () => {
    saveRoomSession('ABCD1234', 'seat-token', 1);
    expect(getRoomSession('ABCD1234')).toEqual({ token: 'seat-token', slot: 1 });
    expect(localStorage.getItem('stratego:ABCD1234:token')).toBe('seat-token');
    expect(localStorage.getItem('stratego:ABCD1234:slot')).toBe('1');
  });

  it('returns null when the token or slot is missing or not 1 or 2', () => {
    expect(getRoomSession('NONE')).toBeNull();
    localStorage.setItem('stratego:BAD:token', 'seat');
    expect(getRoomSession('BAD')).toBeNull();
    localStorage.setItem('stratego:BAD:slot', '3');
    expect(getRoomSession('BAD')).toBeNull();
  });

  it('stores the bot token separately and clears seat data without the color', () => {
    saveRoomSession('ROOM', 'human', 1);
    saveBotToken('ROOM', 'bot-secret');
    setPlayerColor('ROOM', '#8a3a4a');

    expect(getBotToken('ROOM')).toBe('bot-secret');
    clearRoomSession('ROOM');

    expect(getRoomSession('ROOM')).toBeNull();
    expect(getBotToken('ROOM')).toBeNull();
    expect(getPlayerColor('ROOM')).toBe('#8a3a4a');
  });

  it('returns the default army color when none is stored', () => {
    expect(getPlayerColor('NEW')).toBe(DEFAULT_PLAYER_COLOR);
    expect(DEFAULT_PLAYER_COLOR).toBe('#4a7a4a');
  });
});
