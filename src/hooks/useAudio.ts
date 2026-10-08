import { useEffect, useState } from 'react';

export type SoundName =
  | 'move'
  | 'attackWin'
  | 'attackLose'
  | 'tie'
  | 'bomb'
  | 'flagTaken'
  | 'select'
  | 'yourTurn';

export interface AudioState {
  sfxMuted: boolean;
  musicMuted: boolean;
  allMuted: boolean;
  sfxVolume: number;
  musicVolume: number;
}

type FileSound = Exclude<SoundName, 'select' | 'yourTurn'>;

/** Served from public/audio/. flagCaptured.mp3 is unused and is not loaded. */
const SFX_FILES: Record<FileSound, string> = {
  move: '/audio/move.wav',
  attackWin: '/audio/attackWin.wav',
  attackLose: '/audio/attackLose.wav',
  tie: '/audio/tie.wav',
  bomb: '/audio/bomb.wav',
  flagTaken: '/audio/flagTaken.mp3',
};

const MUSIC_URL = '/audio/music.mp3';

function loadState(): AudioState {
  return {
    sfxMuted: localStorage.getItem('stratego:sfxMuted') === '1',
    musicMuted: localStorage.getItem('stratego:musicMuted') === '1',
    allMuted: localStorage.getItem('stratego:allMuted') === '1',
    sfxVolume: parseFloat(localStorage.getItem('stratego:sfxVolume') ?? '0.8'),
    musicVolume: parseFloat(localStorage.getItem('stratego:musicVolume') ?? '0.5'),
  };
}

function saveState(next: AudioState): void {
  localStorage.setItem('stratego:sfxMuted', next.sfxMuted ? '1' : '0');
  localStorage.setItem('stratego:musicMuted', next.musicMuted ? '1' : '0');
  localStorage.setItem('stratego:allMuted', next.allMuted ? '1' : '0');
  localStorage.setItem('stratego:sfxVolume', String(next.sfxVolume));
  localStorage.setItem('stratego:musicVolume', String(next.musicVolume));
}

let state: AudioState = loadState();
let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let masterGain: GainNode | null = null;
const buffers = new Map<FileSound, AudioBuffer>();
const rawBuffers = new Map<FileSound, ArrayBuffer>();
let unlocked = false;
let musicElement: HTMLAudioElement | null = null;
let musicPlaying = false;
let initialized = false;
let initPromise: Promise<void> | null = null;
let unlockHandler: (() => void) | null = null;
let consumerCount = 0;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getAudioState(): AudioState {
  return { ...state };
}

function applyGains(): void {
  if (!ctx || !masterGain || !sfxGain || !musicGain) return;
  masterGain.gain.value = state.allMuted ? 0 : 1;
  sfxGain.gain.value = state.sfxMuted ? 0 : state.sfxVolume;
  musicGain.gain.value = state.musicMuted ? 0 : state.musicVolume;
}

function setupMusicElement(): void {
  if (musicElement || !ctx || !musicGain) return;
  musicElement = new Audio(MUSIC_URL);
  musicElement.loop = true;
  musicElement.preload = 'auto';
  const source = ctx.createMediaElementSource(musicElement);
  source.connect(musicGain);
}

function createAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available');
  return new Ctor();
}

async function bootstrap(): Promise<void> {
  ctx = createAudioContext();

  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.connect(masterGain);

  musicGain = ctx.createGain();
  musicGain.connect(masterGain);

  applyGains();
  setupMusicElement();

  await Promise.all(
    (Object.entries(SFX_FILES) as [FileSound, string][]).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        rawBuffers.set(name, await res.arrayBuffer());
      } catch (error) {
        console.warn(`Failed to load sound: ${name}`, error);
      }
    }),
  );

  initialized = true;
}

async function initAudio(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = bootstrap().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

function playMusic(): void {
  if (!initialized || !ctx || !musicElement || musicPlaying) return;
  void musicElement.play().catch(() => {});
  musicPlaying = true;
}

async function unlockAudio(): Promise<void> {
  if (unlocked || !ctx) return;
  unlocked = true;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    /* context may already be running */
  }

  for (const [name, arrayBuf] of rawBuffers) {
    try {
      buffers.set(name, await ctx.decodeAudioData(arrayBuf));
    } catch (error) {
      console.warn(`Failed to decode sound: ${name}`, error);
    }
  }
  rawBuffers.clear();
  playMusic();
}

function attachUnlock(): void {
  if (unlocked || unlockHandler) return;
  const handler = (): void => {
    unlockHandler = null;
    void unlockAudio();
  };
  unlockHandler = handler;
  document.addEventListener('pointerdown', handler, { once: true, capture: true });
}

function detachUnlock(): void {
  if (!unlockHandler) return;
  document.removeEventListener('pointerdown', unlockHandler, { capture: true });
  unlockHandler = null;
}

function playSynthClick(): void {
  if (!ctx || !sfxGain) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(0.3 * state.sfxVolume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.05);
}

function playSynthChime(): void {
  if (!ctx || !sfxGain) return;
  const t = ctx.currentTime;
  for (const [i, freq] of [440, 660].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25 * state.sfxVolume, t + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.15);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t + i * 0.12);
    osc.stop(t + i * 0.12 + 0.15);
  }
}

function playSound(name: SoundName): void {
  if (!initialized || !ctx || !sfxGain) return;
  if (state.allMuted || state.sfxMuted) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  if (name === 'select') {
    playSynthClick();
    return;
  }
  if (name === 'yourTurn') {
    playSynthChime();
    return;
  }

  const buffer = buffers.get(name);
  if (!buffer) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(sfxGain);
  source.start(0);
}

function setSfxVolume(v: number): void {
  state = { ...state, sfxVolume: Math.max(0, Math.min(1, v)) };
  applyGains();
  saveState(state);
  emit();
}

function setMusicVolume(v: number): void {
  state = { ...state, musicVolume: Math.max(0, Math.min(1, v)) };
  applyGains();
  saveState(state);
  emit();
}

function toggleMuteAll(): void {
  state = { ...state, allMuted: !state.allMuted };
  applyGains();
  saveState(state);
  emit();
}

export function useAudio(): {
  playSound: (name: SoundName) => void;
  toggleMuteAll: () => void;
  setSfxVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
  audioState: AudioState;
} {
  const [audioState, setAudioState] = useState<AudioState>(() => getAudioState());

  useEffect(() => {
    consumerCount += 1;
    let cancelled = false;
    const unsubscribe = subscribe(() => setAudioState(getAudioState()));
    void initAudio()
      .then(() => {
        if (!cancelled && consumerCount > 0) attachUnlock();
      })
      .catch((error: unknown) => {
        console.warn('Failed to init audio', error);
      });
    return () => {
      cancelled = true;
      consumerCount -= 1;
      unsubscribe();
      if (consumerCount === 0) detachUnlock();
    };
  }, []);

  return { playSound, toggleMuteAll, setSfxVolume, setMusicVolume, audioState };
}
