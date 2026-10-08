import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { Layout } from './components/Layout.tsx';
import { HomePage } from './pages/HomePage.tsx';

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
          <Route path="setup" element={<Placeholder name="Setup" />} />
          <Route path="game" element={<Placeholder name="Game" />} />
          <Route path="profile" element={<Placeholder name="Profile" />} />
          <Route path="game-detail" element={<Placeholder name="Game Detail" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
