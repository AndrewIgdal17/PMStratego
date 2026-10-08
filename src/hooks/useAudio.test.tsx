/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GainMock = {
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
};

type OscMock = {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type SourceMock = {
  buffer: unknown;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
};

class MockAudioContext {
  state = 'suspended';
  currentTime = 10;
  destination = {};
  gains: GainMock[] = [];
  oscillators: OscMock[] = [];
  sources: SourceMock[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ byteLength: data.byteLength }));
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));

  createGain(): GainMock {
    const node: GainMock = {
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    this.gains.push(node);
    return node;
  }

  createOscillator(): OscMock {
    const osc: OscMock = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(osc);
    return osc;
  }

  createBufferSource(): SourceMock {
    const source: SourceMock = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  loop = false;
  preload = '';
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();

  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
}

const contexts: MockAudioContext[] = [];
const SFX_URLS = [
  '/audio/move.wav',
  '/audio/attackWin.wav',
  '/audio/attackLose.wav',
  '/audio/tie.wav',
  '/audio/bomb.wav',
  '/audio/flagTaken.mp3',
];

let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

async function loadHook(): Promise<typeof import('./useAudio.ts').useAudio> {
  const mod = await import('./useAudio.ts');
  return mod.useAudio;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  contexts.length = 0;
  FakeAudio.instances = [];
  addSpy = vi.spyOn(document, 'addEventListener');
  removeSpy = vi.spyOn(document, 'removeEventListener');
  vi.stubGlobal(
    'AudioContext',
    class extends MockAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    },
  );
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

afterEach(() => {
  cleanup();
  addSpy.mockRestore();
  removeSpy.mockRestore();
  vi.unstubAllGlobals();
});

async function waitUntilListening(): Promise<EventListener> {
  let handler: EventListener | undefined;
  await waitFor(() => {
    const call = addSpy.mock.calls.find((entry) => entry[0] === 'pointerdown');
    expect(call).toBeTruthy();
    handler = call?.[1] as EventListener;
    expect(call?.[2]).toMatchObject({ once: true, capture: true });
  });
  if (!handler) throw new Error('pointerdown listener was not registered');
  return handler;
}

describe('useAudio', () => {
  it('loads persisted mixer state and does not fetch the unused flag capture file', async () => {
    localStorage.setItem('stratego:sfxMuted', '1');
    localStorage.setItem('stratego:musicMuted', '0');
    localStorage.setItem('stratego:allMuted', '1');
    localStorage.setItem('stratego:sfxVolume', '0.25');
    localStorage.setItem('stratego:musicVolume', '0.4');

    const useAudio = await loadHook();
    const { result } = renderHook(() => useAudio());

    expect(result.current.audioState).toEqual({
      sfxMuted: true,
      musicMuted: false,
      allMuted: true,
      sfxVolume: 0.25,
      musicVolume: 0.4,
    });

    await waitUntilListening();
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(SFX_URLS);
    expect(urls).not.toContain('/audio/flagCaptured.mp3');
    expect(FakeAudio.instances[0]?.src).toBe('/audio/music.mp3');
    expect(FakeAudio.instances[0]?.loop).toBe(true);
    expect(contexts[0]?.decodeAudioData).not.toHaveBeenCalled();
    expect(contexts[0]?.resume).not.toHaveBeenCalled();
  });

  it('clamps volumes, toggles mute-all, and writes the same localStorage keys', async () => {
    const useAudio = await loadHook();
    const { result } = renderHook(() => useAudio());
    await waitUntilListening();

    act(() => {
      result.current.setSfxVolume(1.5);
      result.current.setMusicVolume(-0.2);
    });
    expect(result.current.audioState.sfxVolume).toBe(1);
    expect(result.current.audioState.musicVolume).toBe(0);
    expect(localStorage.getItem('stratego:sfxVolume')).toBe('1');
    expect(localStorage.getItem('stratego:musicVolume')).toBe('0');
    expect(contexts[0]?.gains[1]?.gain.value).toBe(1);
    expect(contexts[0]?.gains[2]?.gain.value).toBe(0);

    act(() => {
      result.current.toggleMuteAll();
    });
    expect(result.current.audioState.allMuted).toBe(true);
    expect(localStorage.getItem('stratego:allMuted')).toBe('1');
    expect(contexts[0]?.gains[0]?.gain.value).toBe(0);

    act(() => {
      result.current.toggleMuteAll();
    });
    expect(result.current.audioState.allMuted).toBe(false);
    expect(localStorage.getItem('stratego:allMuted')).toBe('0');
    expect(contexts[0]?.gains[0]?.gain.value).toBe(1);
  });

  it('defers resume, decode, and music until the first pointerdown', async () => {
    const useAudio = await loadHook();
    const { result } = renderHook(() => useAudio());
    result.current.playSound('select');
    expect(contexts[0]?.oscillators).toHaveLength(0);

    await waitUntilListening();
    document.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(contexts[0]?.resume).toHaveBeenCalledTimes(1);
      expect(contexts[0]?.decodeAudioData).toHaveBeenCalledTimes(SFX_URLS.length);
      expect(FakeAudio.instances[0]?.play).toHaveBeenCalledTimes(1);
    });

    result.current.playSound('move');
    expect(contexts[0]?.sources).toHaveLength(1);
    expect(contexts[0]?.sources[0]?.start).toHaveBeenCalledWith(0);
    expect(contexts[0]?.sources[0]?.connect).toHaveBeenCalledWith(contexts[0]?.gains[1]);

    result.current.playSound('select');
    const click = contexts[0]?.oscillators[0];
    expect(click?.type).toBe('sine');
    expect(click?.frequency.value).toBe(800);
    expect(click?.start).toHaveBeenCalledWith(10);
    expect(click?.stop).toHaveBeenCalledWith(10.05);
    const clickGain = click?.connect.mock.calls[0]?.[0] as GainMock;
    expect(clickGain.gain.setValueAtTime).toHaveBeenCalledWith(0.24, 10);
    expect(clickGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 10.05);
    expect(clickGain.connect).toHaveBeenCalledWith(contexts[0]?.gains[1]);

    result.current.playSound('yourTurn');
    const chime = contexts[0]?.oscillators.slice(1) ?? [];
    expect(chime.map((osc) => osc.frequency.value)).toEqual([440, 660]);
    expect(chime[0]?.start).toHaveBeenCalledWith(10);
    expect(chime[0]?.stop).toHaveBeenCalledWith(10.15);
    expect(chime[1]?.start).toHaveBeenCalledWith(10.12);
    expect(chime[1]?.stop).toHaveBeenCalledWith(10.27);
    const chimeGain = chime[0]?.connect.mock.calls[0]?.[0] as GainMock;
    expect(chimeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.2, 10);
  });

  it('skips playback when sfx or everything is muted', async () => {
    localStorage.setItem('stratego:sfxMuted', '1');
    const useAudio = await loadHook();
    const { result } = renderHook(() => useAudio());
    await waitUntilListening();
    document.dispatchEvent(new Event('pointerdown'));
    await waitFor(() => expect(contexts[0]?.decodeAudioData).toHaveBeenCalled());

    result.current.playSound('select');
    result.current.playSound('move');
    expect(contexts[0]?.oscillators).toHaveLength(0);
    expect(contexts[0]?.sources).toHaveLength(0);
  });

  it('removes the pointerdown listener on unmount when it has not fired', async () => {
    const useAudio = await loadHook();
    const { unmount } = renderHook(() => useAudio());
    const handler = await waitUntilListening();
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', handler, { capture: true });
  });
});
