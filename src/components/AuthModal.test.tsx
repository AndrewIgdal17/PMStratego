/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../contexts/AuthContext.tsx';
import { callFunction } from '../lib/supabaseClient.ts';
import { AuthModal } from './AuthModal.tsx';
import { NavBar } from './NavBar.tsx';

vi.mock('../lib/supabaseClient.ts', async () => {
  const actual = await vi.importActual<typeof import('../lib/supabaseClient.ts')>(
    '../lib/supabaseClient.ts',
  );
  return {
    ...actual,
    callFunction: vi.fn(),
  };
});

function submitAuthForm(): void {
  const password = screen.getByPlaceholderText('Password');
  if (!(password instanceof HTMLInputElement) || !password.form) {
    throw new Error('password field is not in a form');
  }
  fireEvent.submit(password.form);
}

afterEach(() => {
  cleanup();
});

describe('AuthModal password mismatch', () => {
  it('shows an error and does not submit when signup passwords differ', () => {
    const onSubmit = vi.fn();
    render(
      <AuthModal mode="signup" onClose={() => {}} onSwitch={() => {}} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'password2' },
    });
    submitAuthForm();

    const error = screen.getByText('Passwords do not match');
    expect(error.hidden).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the trimmed username and password when they match', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthModal mode="signup" onClose={() => {}} onSwitch={() => {}} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: '  ada  ' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'password1' },
    });
    submitAuthForm();

    expect(onSubmit).toHaveBeenCalledWith('ada', 'password1');
  });

  it('submits login without a confirm field', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthModal mode="login" onClose={() => {}} onSwitch={() => {}} onSubmit={onSubmit} />,
    );

    expect(screen.queryByPlaceholderText('Confirm password')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    submitAuthForm();

    expect(onSubmit).toHaveBeenCalledWith('ada', 'password1');
  });

  it('shows a server error in plain words', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('INVALID_CREDENTIALS'));
    render(
      <AuthModal mode="login" onClose={() => {}} onSwitch={() => {}} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    submitAuthForm();

    const error = await screen.findByText('invalid credentials');
    expect(error.hidden).toBe(false);
  });
});

describe('NavBar auth submit', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(callFunction).mockReset();
  });

  it('calls signup when the signup form is submitted', async () => {
    vi.mocked(callFunction).mockResolvedValue({ token: 'jwt', username: 'ada' });
    render(
      <MemoryRouter>
        <AuthProvider>
          <NavBar />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'password1' },
    });
    submitAuthForm();

    await screen.findByRole('button', { name: 'Log out' });
    expect(callFunction).toHaveBeenCalledWith('signup', {
      username: 'ada',
      password: 'password1',
    });
  });

  it('calls login when the login form is submitted', async () => {
    vi.mocked(callFunction).mockResolvedValue({ token: 'jwt', username: 'ada' });
    render(
      <MemoryRouter>
        <AuthProvider>
          <NavBar />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    submitAuthForm();

    await screen.findByRole('button', { name: 'Log out' });
    expect(callFunction).toHaveBeenCalledWith('login', {
      username: 'ada',
      password: 'password1',
    });
  });

  it('does not call signup when the passwords differ', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <NavBar />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'password2' },
    });
    submitAuthForm();

    expect(screen.getByText('Passwords do not match').hidden).toBe(false);
    expect(callFunction).not.toHaveBeenCalled();
  });
});
