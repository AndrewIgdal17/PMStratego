import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { Layout } from './components/Layout.tsx';
import { GameDetailPage } from './pages/GameDetailPage.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="game" element={<GamePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="game-detail" element={<GameDetailPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
