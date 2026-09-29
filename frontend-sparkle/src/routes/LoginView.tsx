import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, AlertCircle, QrCode } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';

type AuthStep = 'password' | 'mfa' | 'enroll' | 'confirm';

export default function LoginView() {
  const { login, verifyMfa, enroll, confirmEnrollment, status, logout } = useAuth();
  const [step, setStep] = useState<AuthStep>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [enrollData, setEnrollData] = useState<{
    qr_png_base64: string;
    backup_codes: string[];
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);

    try {
      switch (step) {
        case 'password': {
          await login(username.trim(), password);
          // status is updated by AuthProvider
          if (status === 'mfa_required') {
            setStep('mfa');
            setCode('');
            setUseBackupCode(false);
          } else if (status === 'enrollment_required') {
            const enrollRes = await enroll();
            setEnrollData({
              qr_png_base64: enrollRes.qr_png_base64,
              backup_codes: enrollRes.backup_codes,
            });
            setStep('enroll');
          } else if (status === 'ok') {
            // Login complete - AuthProvider handles redirect
          }
          break;
        }
        case 'mfa': {
          if (useBackupCode) {
            await verifyMfa({ backupCode: backupCode.trim() });
          } else {
            await verifyMfa({ code: code.trim() });
          }
          break;
        }
        case 'enroll': {
          setStep('confirm');
          break;
        }
        case 'confirm': {
          await confirmEnrollment(code.trim());
          break;
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollBack = () => {
    setEnrollData(null);
    setStep('password');
    setPassword('');
  };

  const handleMfaBack = () => {
    setStep('password');
    setPassword('');
    setCode('');
    setBackupCode('');
    setUseBackupCode(false);
  };

  const handleConfirmBack = () => {
    setStep('enroll');
    setCode('');
  };

  // Note: We don't check status here - App.tsx handles the redirect
  // The AuthProvider sets status to 'authenticated' on successful login

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Background */}
      <div className="galaxy-nebula pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
      <div className="galaxy-vignette pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted shadow-lg">
            <span className="text-2xl font-bold text-primary">L</span>
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">LEX</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sovereign AI Workbench</p>
        </div>

        {/* Login Card */}
        <form onSubmit={handleSubmit} className="panel space-y-5 p-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sign in</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              All credentials are verified locally — no external auth services.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {step === 'password' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-10 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'mfa' && (
            <div className="space-y-3">
              <div className="text-center mb-4">
                <QrCode className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Enter TOTP code from your authenticator app</p>
              </div>

              {!useBackupCode && (
                <>
                  <div>
                    <label htmlFor="mfa-code" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      6-digit code
                    </label>
                    <input
                      id="mfa-code"
                      type="text"
                      autoFocus
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="000000"
                      maxLength={6}
                      className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring text-center tracking-widest"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseBackupCode(true)}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Use backup code instead
                  </button>
                </>
              )}

              {useBackupCode && (
                <>
                  <div>
                    <label htmlFor="backup-code" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Backup code
                    </label>
                    <input
                      id="backup-code"
                      type="text"
                      autoFocus
                      autoComplete="one-time-code"
                      value={backupCode}
                      onChange={(e) => setBackupCode(e.target.value)}
                      placeholder="xxxxxxxx"
                      maxLength={8}
                      className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring text-center tracking-widest"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseBackupCode(false)}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Use TOTP code instead
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'enroll' && enrollData && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Scan QR code with your authenticator app</p>
                <div className="mx-auto">
                  <img
                    src={`data:image/png;base64,${enrollData.qr_png_base64}`}
                    alt="TOTP QR code"
                    className="w-48 h-48 rounded border border-border bg-background p-2"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">Or use the secret key from the QR code</p>
              </div>

              <div className="panel p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Backup codes (shown once — save them securely)</p>
                <div className="grid grid-cols-2 gap-2">
                  {enrollData.backup_codes.map((bc, i) => (
                    <code key={i} className="font-mono text-xs bg-muted px-2 py-1 rounded border border-border">
                      {bc}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-3">
              <div className="text-center mb-4">
                <QrCode className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator to confirm enrollment</p>
              </div>
              <div>
                <label htmlFor="confirm-code" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  6-digit code
                </label>
                <input
                  id="confirm-code"
                  type="text"
                  autoFocus
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring text-center tracking-widest"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading ||
              (step === 'password' && (!username.trim() || !password.trim())) ||
              (step === 'mfa' && !useBackupCode && code.length !== 6) ||
              (step === 'mfa' && useBackupCode && backupCode.length !== 8) ||
              (step === 'confirm' && code.length !== 6)
            }
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="spin-slow h-4 w-4" aria-hidden="true" />
                Authenticating…
              </>
            ) : step === 'password' ? (
              'Sign in'
            ) : step === 'mfa' ? (
              'Verify'
            ) : step === 'enroll' ? (
              'Continue to confirm'
            ) : (
              'Confirm enrollment'
            )}
          </button>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-center text-xs text-muted-foreground">
              Demo: admin / admin123
            </p>
            {step !== 'password' && (
              <button
                type="button"
                onClick={
                  step === 'mfa' ? handleMfaBack :
                  step === 'enroll' ? handleEnrollBack :
                  handleConfirmBack
                }
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                <span>← Back</span>
              </button>
            )}
          </div>
        </form>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          All data stays on-premise · Zero external connections · JWT signed locally
        </p>
      </div>
    </div>
  );
}