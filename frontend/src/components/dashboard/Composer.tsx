import { useRef, useState } from "react";
import { Loader2, Paperclip, SendHorizontal, X } from "lucide-react";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string, attachments: string[], files: File[]) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    const names = files.map((f) => f.name);
    onSend(t, names, files);
    setText("");
    setFiles([]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]);
      }}
      className={`panel-raised p-2.5 transition-colors ${dragging ? "border-primary/70" : ""}`}
    >
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-[11px]">
              <span className="max-w-40 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          disabled={disabled}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? "Task in progress — composer locked" : "Describe the task for the agent system…"}
          aria-label="Task input"
          className="thin-scroll min-h-16 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-label="Attach files"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={disabled || !text.trim()}
            onClick={submit}
            aria-label="Send task"
            className="rounded-md bg-primary p-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {disabled ? <Loader2 className="spin-slow h-4 w-4" aria-hidden="true" /> : <SendHorizontal className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.jpg,.jpeg,.png"
        className="sr-only"
        onChange={(e) => {
          setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line · PDF, DOCX, JPG, PNG supported
      </p>
    </div>
  );
}
