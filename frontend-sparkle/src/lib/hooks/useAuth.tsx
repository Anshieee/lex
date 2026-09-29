import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { login as apiLogin, verifyMfa as apiVerifyMfa, enroll as apiEnroll, confirmEnrollment as apiConfirmEnrollment } from '@/lib/api';

type MfaStatus = 'ok' | 'mfa_required' | 'enrollment_required' | 'unknown' | 'unauthenticated';
type AuthStatus = 'loading' | MfaStatus;

interface User {
  username: string;
  role: string;
  token: string;
}

interface AuthContextType {
  status: AuthStatus;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  verifyMfa: (params: { code?: string; backupCode?: string }) => Promise<void>;
  enroll: () => Promise<{ qr_png_base64: string; backup_codes: string[] }>;
  confirmEnrollment: (code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('lex_token');
    const userStr = localStorage.getItem('lex_user');
    if (token && userStr) {
      try {
        const userData = JSON.parse(userStr);
        setUser({ username: userData.username, role: userData.role, token });
        setStatus('ok');
      } catch {
        localStorage.removeItem('lex_token');
        localStorage.removeItem('lex_user');
        setStatus('unauthenticated');
      }
    } else {
      setStatus('unauthenticated');
    }
  }, []);

  const handleLogin = async (username: string, password: string) => {
    const res = await apiLogin({ username, password });
    if (res.status === 'ok' && res.access_token) {
      const userData = { username, role: res.role || 'user', token: res.access_token };
      localStorage.setItem('lex_token', res.access_token);
      localStorage.setItem('lex_user', JSON.stringify(userData));
      setUser(userData);
      setStatus('ok');
    } else if (res.status === 'mfa_required' || res.status === 'enrollment_required') {
      localStorage.setItem('lex_mfa_token', res.mfa_token || res.enroll_token || '');
      localStorage.setItem('lex_mfa_token_type', res.status);
      setStatus(res.status);
    } else {
      throw new Error(res.status);
    }
  };

  const handleVerifyMfa = async (params: { code?: string; backupCode?: string }) => {
    const mfaToken = localStorage.getItem('lex_mfa_token');
    if (!mfaToken) throw new Error('No MFA token');

    const res = await apiVerifyMfa({ mfa_token: mfaToken, code: params.code, backup_code: params.backupCode });

    const userData = { username: '', role: res.role, token: res.access_token };
    localStorage.setItem('lex_token', res.access_token);
    localStorage.setItem('lex_user', JSON.stringify(userData));
    localStorage.removeItem('lex_mfa_token');
    localStorage.removeItem('lex_mfa_token_type');
    setUser(userData);
    setStatus('ok');
  };

  const handleEnroll = async () => {
    const mfaToken = localStorage.getItem('lex_mfa_token');
    if (!mfaToken) throw new Error('No enrollment token');

    const res = await apiEnroll(mfaToken);

    return res;
  };

  const handleConfirmEnrollment = async (code: string) => {
    const enrollToken = localStorage.getItem('lex_mfa_token');
    if (!enrollToken) throw new Error('No enrollment token');

    const result = await apiConfirmEnrollment(enrollToken, code);

    const userData = { username: '', role: result.role, token: result.access_token };
    localStorage.setItem('lex_token', result.access_token);
    localStorage.setItem('lex_user', JSON.stringify(userData));
    localStorage.removeItem('lex_mfa_token');
    localStorage.removeItem('lex_mfa_token_type');
    localStorage.removeItem('lex_enroll_token');
    setUser(userData);
    setStatus('ok');
  };

  const logout = useCallback(() => {
    localStorage.removeItem('lex_token');
    localStorage.removeItem('lex_user');
    localStorage.removeItem('lex_mfa_token');
    localStorage.removeItem('lex_mfa_token_type');
    localStorage.removeItem('lex_enroll_token');
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{
      status,
      user,
      login: handleLogin,
      verifyMfa: handleVerifyMfa,
      enroll: handleEnroll,
      confirmEnrollment: handleConfirmEnrollment,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}