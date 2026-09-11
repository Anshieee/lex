import { useState } from "react";
import {
  PanelLeft,
  Search,
  SquarePen,
  Library,
  FolderClosed,
  Clock,
  Plug,
  MoreHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "New chat", icon: SquarePen },
  { label: "Library", icon: Library },
  { label: "Projects", icon: FolderClosed },
  { label: "Scheduled", icon: Clock },
  { label: "Plugins", icon: Plug },
  { label: "More", icon: MoreHorizontal },
];

const RECENTS = [
  "Compliance summary draft",
  "Archive corpus triage",
  "Vendor risk brief",
  "Q3 audit checklist",
  "Local model routing test",
  "Redaction policy notes",
  "Incident timeline recap",
  "Document ingest review",
];

export function NavSidebar({
  open,
  onClose,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}) {
  const [active, setActive] = useState(0);
  const [activeRecent, setActiveRecent] = useState(0);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
        />
      )}
      <nav
        aria-label="Main navigation"
        aria-hidden={!open}
        className={cn(
          "panel fixed inset-y-3 left-3 z-40 flex w-[min(17rem,calc(100vw-1.5rem))] flex-col transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none -translate-x-[calc(100%+1rem)]",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
          <span className="truncate text-sm font-semibold tracking-tight">LEX</span>
          <div className="flex items-center gap-1">
            <IconBtn label="Search conversations" icon={Search} />
            <IconBtn label="Collapse sidebar" icon={PanelLeft} onClick={onClose} className="hidden lg:inline-flex" />
            <IconBtn label="Close sidebar" icon={X} onClick={onClose} className="lg:hidden" />
          </div>
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ul className="space-y-0.5">
            {NAV.map((item, i) => (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={() => {
                    setActive(i);
                    if (item.label === "New chat") {
                      onNewChat();
                      onClose();
                    }
                  }}
                  aria-current={active === i ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                    active === i
                      ? "bg-accent text-accent-foreground"
                      : "text-secondary-foreground hover:bg-accent/60",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recents
          </p>
          <ul className="space-y-0.5">
            {RECENTS.map((r, i) => (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => setActiveRecent(i)}
                  className={cn(
                    "w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    activeRecent === i
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>

        </div>

        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
          >
            {(() => {
              let displayName = "User";
              let role = "operator";
              try {
                const raw = localStorage.getItem("lex_user");
                if (raw) {
                  const u = JSON.parse(raw);
                  displayName = u.display_name || u.username || "User";
                  role = u.role || "operator";
                }
              } catch {}
              const initials = displayName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[11px] text-primary-foreground">
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{displayName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{role} · Local workspace</span>
                  </span>
                </>
              );
            })()}
            <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      </nav>
    </>
  );
}

function IconBtn({
  label,
  icon: Icon,
  onClick,
  className,
}: {
  label: string;
  icon: typeof Search;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
