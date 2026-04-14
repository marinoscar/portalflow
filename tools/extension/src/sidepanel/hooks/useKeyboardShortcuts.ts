import { useEffect } from 'react';

/**
 * Fires `onUndo` on Ctrl/Cmd+Z and `onRedo` on Ctrl/Cmd+Shift+Z, unless
 * the event target is a form control (input/textarea/contenteditable) —
 * in which case the browser's native undo on that control wins.
 */
export function useUndoRedoShortcuts(
  onUndo: () => void,
  onRedo: () => void,
): void {
  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function handleKey(ev: KeyboardEvent) {
      const ctrlOrMeta = ev.ctrlKey || ev.metaKey;
      if (!ctrlOrMeta) return;
      // Only Z / z triggers undo/redo
      if (ev.key.toLowerCase() !== 'z') return;
      if (isEditable(ev.target)) return; // let the native control handle it

      ev.preventDefault();
      if (ev.shiftKey) {
        onRedo();
      } else {
        onUndo();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onUndo, onRedo]);
}
