import { Routes, Route } from 'react-router-dom';

function Placeholder({ name }: { name: string }) {
  return <div className="page-shell"><div className="page-frame"><h1>{name}</h1><p>Coming soon.</p></div></div>;
}

export function App() {
  return (
    <Routes>
      <Route index element={<Placeholder name="Home" />} />
      <Route path="setup" element={<Placeholder name="Setup" />} />
      <Route path="game" element={<Placeholder name="Game" />} />
      <Route path="profile" element={<Placeholder name="Profile" />} />
      <Route path="game-detail" element={<Placeholder name="Game Detail" />} />
    </Routes>
  );
}
