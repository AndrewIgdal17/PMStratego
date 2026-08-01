const AUDIO_BASE = '../audio/';

const SFX_FILES = {
  move: 'move.wav',
  attackWin: 'attackWin.wav',
  attackLose: 'attackLose.wav',
  tie: 'tie.wav',
  bomb: 'bomb.wav',
  flagCaptured: 'flagCaptured.mp3',
  flagTaken: 'flagTaken.mp3',
};

const MUSIC_FILE = 'music.mp3';

let ctx = null;
let sfxGain = null;
let musicGain = null;
let masterGain = null;
let buffers = new Map();
let musicElement = null;
let musicMediaSource = null;
let musicPlaying = false;
let initialized = false;

function loadState() {
  return {
    sfxMuted: localStorage.getItem('stratego:sfxMuted') === '1',
    musicMuted: localStorage.getItem('stratego:musicMuted') === '1',
    allMuted: localStorage.getItem('stratego:allMuted') === '1',
    sfxVolume: parseFloat(localStorage.getItem('stratego:sfxVolume') ?? '0.8'),
    musicVolume: parseFloat(localStorage.getItem('stratego:musicVolume') ?? '0.5'),
  };
}

function saveState(state) {
  localStorage.setItem('stratego:sfxMuted', state.sfxMuted ? '1' : '0');
  localStorage.setItem('stratego:musicMuted', state.musicMuted ? '1' : '0');
  localStorage.setItem('stratego:allMuted', state.allMuted ? '1' : '0');
  localStorage.setItem('stratego:sfxVolume', String(state.sfxVolume));
  localStorage.setItem('stratego:musicVolume', String(state.musicVolume));
}

let state = loadState();

function applyGains() {
  if (!ctx) return;
  const allMute = state.allMuted;
  masterGain.gain.value = allMute ? 0 : 1;
  sfxGain.gain.value = state.sfxMuted ? 0 : state.sfxVolume;
  musicGain.gain.value = state.musicMuted ? 0 : state.musicVolume;
}

function setupMusicElement(basePath) {
  if (musicElement) return;
  musicElement = new Audio(basePath + MUSIC_FILE);
  musicElement.loop = true;
  musicElement.preload = 'auto';
  musicMediaSource = ctx.createMediaElementSource(musicElement);
  musicMediaSource.connect(musicGain);
}

export async function initAudio() {
  if (initialized) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.connect(masterGain);

  musicGain = ctx.createGain();
  musicGain.connect(masterGain);

  applyGains();

  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const basePath = new URL(AUDIO_BASE, import.meta.url).href;

  setupMusicElement(basePath);

  const loadPromises = Object.entries(SFX_FILES).map(async ([name, file]) => {
    try {
      const res = await fetch(basePath + file);
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      buffers.set(name, audioBuf);
    } catch (e) {
      console.warn(`Failed to load sound: ${name}`, e);
    }
  });

  await Promise.all(loadPromises);
  initialized = true;
}

export function playSound(name) {
  if (!initialized || !ctx) return;
  if (state.allMuted || state.sfxMuted) return;

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

function playSynthClick() {
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

function playSynthChime() {
  const t = ctx.currentTime;
  [440, 660].forEach((freq, i) => {
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
  });
}

export function playMusic() {
  if (!initialized || !ctx || !musicElement || musicPlaying) return;
  musicElement.play().catch(() => {});
  musicPlaying = true;
}

export function stopMusic() {
  if (!musicPlaying || !musicElement) return;
  musicElement.pause();
  musicPlaying = false;
}

export function setSfxVolume(v) {
  state.sfxVolume = Math.max(0, Math.min(1, v));
  applyGains();
  saveState(state);
}

export function setMusicVolume(v) {
  state.musicVolume = Math.max(0, Math.min(1, v));
  applyGains();
  saveState(state);
}

export function toggleMuteSfx() {
  state.sfxMuted = !state.sfxMuted;
  applyGains();
  saveState(state);
  return state.sfxMuted;
}

export function toggleMuteMusic() {
  state.musicMuted = !state.musicMuted;
  applyGains();
  saveState(state);
  return state.musicMuted;
}

export function toggleMuteAll() {
  state.allMuted = !state.allMuted;
  applyGains();
  saveState(state);
  return state.allMuted;
}

export function getAudioState() {
  return { ...state };
}

export function isMusicPlaying() {
  return musicPlaying;
}
