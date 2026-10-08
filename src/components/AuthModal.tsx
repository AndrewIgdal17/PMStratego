import { useState, type FormEvent } from 'react';

export type AuthMode = 'login' | 'signup';

interface AuthModalProps {
  mode: AuthMode;
  onClose: () => void;
  onSwitch: () => void;
  onSubmit: (username: string, password: string) => Promise<void> | void;
}

export function AuthModal({ mode, onClose, onSwitch, onSubmit }: AuthModalProps) {
  const isSignup = mode === 'signup';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const trimmed = username.trim();

    if (isSignup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    try {
      await onSubmit(trimmed, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      setError(message.replace(/_/g, ' ').toLowerCase());
    }
  }

  return (
    <div className="modal-overlay" id="auth-modal">
      <div className="modal-content auth-modal-content">
        <h3>{isSignup ? 'Sign Up' : 'Log In'}</h3>
        <form id="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <input
            id="auth-username"
            type="text"
            placeholder="Username"
            required
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            id="auth-password"
            type="password"
            placeholder="Password"
            required
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {isSignup ? (
            <input
              id="auth-confirm"
              type="password"
              placeholder="Confirm password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          ) : null}
          <p id="auth-error" className="error" hidden={error === null}>
            {error}
          </p>
          <button type="submit" className="btn-primary">
            {isSignup ? 'Sign Up' : 'Log In'}
          </button>
        </form>
        <p className="auth-switch">
          {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
          <button type="button" id="auth-switch-btn" className="link-btn" onClick={onSwitch}>
            {isSignup ? 'Log in' : 'Sign up'}
          </button>
        </p>
        <button type="button" id="auth-close-btn" className="modal-close" onClick={onClose}>
          &times;
        </button>
      </div>
    </div>
  );
}
