import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { Layout } from './components/Layout.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';

function Placeholder({ name }: { name: string }) {
  return (
    <div className="page-shell">
      <div className="page-frame">
        <h1>{name}</h1>
        <p>Coming soon.</p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="game" element={<GamePage />} />
          <Route path="profile" element={<Placeholder name="Profile" />} />
          <Route path="game-detail" element={<Placeholder name="Game Detail" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
