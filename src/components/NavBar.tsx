import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { AuthModal, type AuthMode } from './AuthModal.tsx';

interface NavBarProps {
  roomCode?: string;
}

export function NavBar({ roomCode }: NavBarProps) {
  const { auth, isLoggedIn, login, signup, logout } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode | null>(null);

  const code = roomCode !== undefined ? roomCode : params.get('code');
  const spectating = params.get('spectate') === '1';
  const showHome = location.pathname !== '/';

  async function handleSubmit(username: string, password: string): Promise<void> {
    if (mode === 'signup') await signup(username, password);
    else await login(username, password);
    setMode(null);
  }

  return (
    <nav className="top-nav">
      <Link to="/" className="nav-brand">
        Stratego
      </Link>
      <div className="nav-links">
        <div className="nav-auth">
          {isLoggedIn ? (
            <>
              {auth.username ? (
                <Link
                  to={`/profile?user=${encodeURIComponent(auth.username)}`}
                  className="nav-user"
                >
                  {auth.username}
                </Link>
              ) : null}
              <button type="button" id="logout-btn" className="nav-link-btn" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                id="open-login-btn"
                className="nav-link-btn"
                onClick={() => setMode('login')}
              >
                Log in
              </button>
              <button
                type="button"
                id="open-signup-btn"
                className="nav-link-btn"
                onClick={() => setMode('signup')}
              >
                Sign up
              </button>
            </>
          )}
        </div>
        {code ? (
          <span id="nav-room-code" className="nav-context">
            {`Room: ${code}${spectating ? ' (Spectating)' : ''}`}
          </span>
        ) : null}
        {showHome ? <Link to="/">Home</Link> : null}
      </div>
      {mode ? (
        <AuthModal
          key={mode}
          mode={mode}
          onClose={() => setMode(null)}
          onSwitch={() => setMode(mode === 'login' ? 'signup' : 'login')}
          onSubmit={handleSubmit}
        />
      ) : null}
    </nav>
  );
}
