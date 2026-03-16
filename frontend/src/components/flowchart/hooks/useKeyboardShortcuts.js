import { useEffect } from 'react';

export function useKeyboardShortcuts({ onDelete, onSave }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave?.();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        onDelete?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDelete, onSave]);
}
