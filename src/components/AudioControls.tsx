import type { JSX } from 'react';
import { useAudio } from '../hooks/useAudio.ts';

export function AudioControls(): JSX.Element {
  const { audioState, toggleMuteAll, setSfxVolume, setMusicVolume } = useAudio();

  return (
    <>
      <h3>Audio</h3>
      <div className="audio-controls">
        <label>
          <input
            type="checkbox"
            id="mute-all-side"
            checked={audioState.allMuted}
            onChange={() => toggleMuteAll()}
          />
          Mute All
        </label>
        <label>
          SFX
          <input
            type="range"
            id="sfx-vol-side"
            min={0}
            max={100}
            value={Math.round(audioState.sfxVolume * 100)}
            onChange={(event) => setSfxVolume(Number(event.target.value) / 100)}
          />
        </label>
        <label>
          Music
          <input
            type="range"
            id="music-vol-side"
            min={0}
            max={100}
            value={Math.round(audioState.musicVolume * 100)}
            onChange={(event) => setMusicVolume(Number(event.target.value) / 100)}
          />
        </label>
      </div>
    </>
  );
}
