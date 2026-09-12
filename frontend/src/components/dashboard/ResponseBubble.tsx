import { useMemo } from "react";
import { Terminal } from "lucide-react";

/**
 * Lightweight markdown → HTML renderer for the agent's conversational response.
 * Handles: headers, bold, italic, code blocks, inline code, lists, and links.
 * No external dependency needed — keeps the bundle lean.
 */
function renderMarkdown(md: string): string {
  let html = md
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks (```lang ... ```)
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
    return `<div class="code-block-wrap">${langLabel}<pre class="code-block"><code>${code.trim()}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Headers (### → h4, ## → h3, # → h2)
  html = html.replace(/^#### (.+)$/gm, '<h5 class="resp-h5">$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4 class="resp-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="resp-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="resp-h2">$1</h2>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Unordered lists
  html = html.replace(/^[\s]*[-*] (.+)$/gm, '<li class="resp-li">$1</li>');
  html = html.replace(/((<li class="resp-li">.*<\/li>\n?)+)/g, '<ul class="resp-ul">$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="resp-oli">$1</li>');
  html = html.replace(/((<li class="resp-oli">.*<\/li>\n?)+)/g, '<ol class="resp-ol">$1</ol>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="resp-hr" />');

  // Paragraphs — wrap remaining non-tag lines
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<")) return trimmed;
      return `<p class="resp-p">${trimmed.replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");

  return html;
}

/** Completed response bubble — static markdown content. */
export function ResponseBubble({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <div className="response-bubble max-w-[90%]" id="agent-response">
      {/* Avatar */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
          <Terminal className="h-3 w-3 text-primary" aria-hidden="true" />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
          LEX
        </span>
      </div>

      {/* Markdown content */}
      <div
        className="response-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/** Live streaming bubble — accumulates tokens with a blinking cursor. */
export function StreamingBubble({ text, isComplete }: { text: string; isComplete: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <div className="response-bubble response-bubble--streaming max-w-[90%]" id="agent-streaming">
      {/* Avatar with pulse */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
          <Terminal className="h-3 w-3 text-primary" aria-hidden="true" />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
          LEX
        </span>
        {!isComplete && (
          <span className="status-dot status-dot--ok status-dot--pulse ml-1" aria-hidden="true" />
        )}
      </div>

      {/* Streaming content */}
      <div className="response-content">
        <span dangerouslySetInnerHTML={{ __html: html }} />
        {!isComplete && <span className="streaming-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}
