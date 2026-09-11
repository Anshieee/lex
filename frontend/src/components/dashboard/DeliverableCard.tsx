import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { Deliverable } from "@/lib/agent/types";
import { downloadDocx } from "@/lib/agent/docx";

const API_BASE = "http://127.0.0.1:8000";

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("lex_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function DeliverableCard({ deliverable }: { deliverable: Deliverable }) {
  const handleDownloadDocx = async () => {
    try {
      // 1. Attempt to download the real file produced by the FastAPI backend
      const response = await fetch(`${API_BASE}/api/tasks/${deliverable.id}/download`, {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = deliverable.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(downloadUrl);
        return;
      }
    } catch {
      // Fall through to client generator if server endpoint is unreachable
    }

    // 2. Client-side fallback
    downloadDocx(deliverable.filename, "MRPL Sovereign Agent Deliverable", deliverable.content);
  };

  const handleDownloadXlsx = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${deliverable.id}/download/xlsx`, {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = deliverable.filename.replace(".docx", ".xlsx");
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(downloadUrl);
      }
    } catch {
      // xlsx only available from backend
    }
  };

  return (
    <section aria-label="Deliverable" className="panel-raised border-ok/35 p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <FileText className="h-4 w-4 text-ok" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{deliverable.filename}</p>
          <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            docx + xlsx · generated locally
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={handleDownloadDocx}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <FileText className="h-3 w-3" aria-hidden="true" />
          DOCX
        </button>
        <button
          type="button"
          onClick={handleDownloadXlsx}
          className="inline-flex items-center gap-1.5 rounded-md border border-ok/40 bg-ok/10 px-3 py-1.5 text-xs font-semibold text-ok transition-colors hover:bg-ok/20"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
          XLSX
        </button>
      </div>
    </section>
  );
}
