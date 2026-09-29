import type { RoutingWeights } from '@/lib/types';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: 'chat' | 'routing' | 'approval' | 'settings') => void;
  isSidebarOpen: boolean;
  onToggleSidebar?: () => void;
}

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'routing', label: 'Routing', icon: '⚡' },
  { id: 'approval', label: 'Approvals', icon: '✅' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

export default function Navbar({ currentView, onNavigate, isSidebarOpen, onToggleSidebar }: NavbarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col border-r border-border bg-panel">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-sm font-bold">L</span>
            </div>
            <span className="font-semibold tracking-tight">LEX Sparkle</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Client-side console</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id as typeof item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                currentView === item.id
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-ok pulse" />
            <span>Backend connected</span>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {isSidebarOpen && (
        <aside className="fixed inset-y-0 left-0 w-64 z-40 lg:hidden bg-panel border-r border-border">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <span className="text-primary text-sm font-bold">L</span>
              </div>
              <span className="font-semibold">LEX Sparkle</span>
            </div>
            <button
              onClick={() => onNavigate(currentView as any)}
              className="p-2 rounded-md hover:bg-accent"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id as any); onToggleSidebar?.(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === item.id
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
      )}
    </>
  );
}
