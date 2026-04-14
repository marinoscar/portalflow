import { useEffect } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 3000;

/**
 * Lightweight toast stack anchored to the bottom-right of the side panel.
 * Each toast auto-dismisses after 3 seconds; the close button dismisses
 * immediately. Hover over a toast to pause its auto-dismiss (via CSS
 * animation-play-state: paused).
 */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast toast--${toast.kind}`}>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        type="button"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Minimal toast controller: stable push() / dismiss() and an id generator.
 * Exposed as a hook so App can hold the state and pass it to ToastStack.
 */
export function useToasts() {
  const [toasts, setToasts] = useToastsState();
  const push = (kind: ToastKind, message: string) => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
  };
  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };
  return { toasts, push, dismiss };
}

// Thin wrapper around useState to keep the hook above type-inferred without
// an extra dependency import at the top level.
import { useState } from 'react';
function useToastsState() {
  return useState<Toast[]>([]);
}
