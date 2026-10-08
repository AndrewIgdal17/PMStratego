import { Outlet } from 'react-router-dom';
import { NavBar } from './NavBar.tsx';

export function Layout() {
  return (
    <>
      <NavBar />
      <Outlet />
    </>
  );
}
