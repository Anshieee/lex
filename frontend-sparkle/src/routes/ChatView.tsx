import { useState, useCallback } from 'react';
import { submitTask } from '@/lib/api';

export default function ChatView() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string; at: number }>>([]);
  const [isRunning, setIsRunning] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning) return;

    const userText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText, at: Date.now() }]);
    setIsRunning(true);

    try {
      const result = await submitTask(userText);
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: result.status === 'waiting_approval'
          ? 'Task submitted — approval required before execution.'
          : 'Task completed successfully.',
        at: Date.now(),
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        at: Date.now(),
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [input, isRunning]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 thin-scroll">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <h2 className="text-lg font-semibold text-foreground">Start a task</h2>
            <p className="mt-1 text-sm max-w-sm">
              Describe what you want the agent to do. It will decompose the task, route to the best model, and request approval when needed.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-panel border border-border'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}
        {isRunning && (
          <div className="flex justify-start">
            <div className="bg-panel border border-border rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary pulse" />
                <span className="text-sm text-muted-foreground">Processing...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your task..."
            disabled={isRunning}
            className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isRunning || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isRunning ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
