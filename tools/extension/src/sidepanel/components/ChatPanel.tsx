import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../shared/types';
import { ProposalCard } from './ProposalCard';

interface ChatPanelProps {
  messages: ChatMessage[];
  isSending: boolean;
  hasProvider: boolean;
  onSend: (text: string) => void;
  onApprove: (messageId: string) => void;
  onReject: (messageId: string) => void;
  onClear: () => void;
}

const SUGGESTED_PROMPTS = [
  'Extract the login steps into a reusable function',
  'Add error handling to the download step',
  'Explain what this automation does',
];

export function ChatPanel({
  messages,
  isSending,
  hasProvider,
  onSend,
  onApprove,
  onReject,
  onClear,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to the newest message when a new one arrives.
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isSending]);

  function submit() {
    const text = draft.trim();
    if (!text || isSending || !hasProvider) return;
    onSend(text);
    setDraft('');
  }

  function handleKey(ev: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      submit();
    }
  }

  function applySuggestion(s: string) {
    setDraft(s);
  }

  return (
    <section className="card chat-panel">
      <div className="chat-panel-header">
        <h2 className="card-title">AI Chat</h2>
        {messages.length > 0 && (
          <button
            className="chat-panel-clear"
            onClick={onClear}
            aria-label="Clear chat history"
            type="button"
          >
            Clear
          </button>
        )}
      </div>

      <div className="chat-panel-body" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="muted">
              Ask the AI to improve this automation. Examples:
            </p>
            <ul className="chat-suggestions">
              {SUGGESTED_PROMPTS.map((s) => (
                <li key={s}>
                  <button
                    className="chat-suggestion-button"
                    onClick={() => applySuggestion(s)}
                    type="button"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-message chat-message--${m.role}`}
          >
            <div className="chat-message-role">
              {m.role === 'user' ? 'You' : 'AI'}
            </div>
            <div className="chat-message-content">{m.content}</div>
            {m.parseError && (
              <div className="chat-message-error">
                Failed to parse response: {m.parseError}
              </div>
            )}
            {m.proposal && (
              <ProposalCard
                proposal={m.proposal}
                onApprove={() => onApprove(m.id)}
                onReject={() => onReject(m.id)}
              />
            )}
          </div>
        ))}

        {isSending && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-message-role">AI</div>
            <div className="chat-message-content chat-thinking">
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
            </div>
          </div>
        )}
      </div>

      <div className="chat-panel-input">
        <textarea
          className="chat-input"
          placeholder={
            hasProvider
              ? 'Ask for a change or a question… (Ctrl+Enter to send)'
              : 'Configure an LLM provider to use the chat'
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          disabled={isSending || !hasProvider}
          rows={3}
        />
        <button
          className="btn-primary"
          onClick={submit}
          disabled={isSending || !hasProvider || draft.trim() === ''}
          type="button"
        >
          {isSending ? 'Thinking…' : 'Send'}
        </button>
      </div>
    </section>
  );
}
