import { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/hooks/useAuth';
import LoginView from './routes/LoginView';
import ChatView from './routes/ChatView';
import RoutingView from './routes/RoutingView';
import ApprovalView from './routes/ApprovalView';
import SettingsView from './routes/SettingsView';
import ReportsView from './routes/ReportsView';
import AuditView from './routes/AuditView';
import ModelsView from './routes/ModelsView';
import AnalyticsView from './routes/AnalyticsView';
import { LogOut, BarChart3, FileText, Shield, Settings, Menu, X, User } from 'lucide-react';

type View = 'chat' | 'routing' | 'approval' | 'settings' | 'reports' | 'audit' | 'models' | 'analytics';

const NAV_ITEMS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <span>💬</span> },
  { id: 'routing', label: 'Routing', icon: <span>⚡</span> },
  { id: 'models', label: 'Models', icon: <span>🧠</span> },
  { id: 'approval', label: 'Approvals', icon: <span>✅</span> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'reports', label: 'Reports', icon: <FileText className="w-4 h-4" /> },
  { id: 'audit', label: 'Audit', icon: <Shield className="w-4 h-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
];

function AppContent() {
  const { status, user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent spin-slow" />
          <span>Initializing...</span>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginView />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col border-r border-border bg-panel shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-sm font-bold">L</span>
            </div>
            <span className="font-semibold tracking-tight">LEX Sparkle</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Lightweight client SPA</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                currentView === item.id
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-border space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-ok" />
            <span>Connected</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <User className="w-3 h-3" />
            <span>{user?.username}</span>
            <span className="text-primary">({user?.role})</span>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {isSidebarOpen && (
        <>
          <aside className="fixed inset-y-0 left-0 w-64 z-40 lg:hidden bg-panel border-r border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <span className="text-primary text-sm font-bold">L</span>
                </div>
                <span className="font-semibold">LEX Sparkle</span>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 rounded-md hover:bg-accent"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setCurrentView(item.id); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    currentView === item.id
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <User className="w-3 h-3" />
                <span>{user?.username}</span>
                <span className="text-primary">({user?.role})</span>
              </div>
              <button
                onClick={() => { logout(); setIsSidebarOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                <LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
            </div>
          </aside>
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        </>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-panel/50">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden p-2 rounded-md hover:bg-accent transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold tracking-tight">
            {NAV_ITEMS.find(n => n.id === currentView)?.label ?? 'LEX Sparkle'}
          </h1>
        </header>
        <div className="flex-1 overflow-hidden">
          {currentView === 'chat' && <ChatView />}
          {currentView === 'routing' && <RoutingView />}
          {currentView === 'models' && <ModelsView />}
          {currentView === 'approval' && <ApprovalView />}
          {currentView === 'analytics' && <AnalyticsView />}
          {currentView === 'reports' && <ReportsView />}
          {currentView === 'audit' && <AuditView />}
          {currentView === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
