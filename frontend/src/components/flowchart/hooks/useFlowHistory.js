import { useState } from 'react';

export function useFlowHistory() {
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveToHistory = (snapshot) => {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), snapshot]);
    setHistoryIndex((prev) => prev + 1);
  };

  const undo = () => {
    if (historyIndex <= 0) return null;
    setHistoryIndex((prev) => prev - 1);
    return history[historyIndex - 1] || null;
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return null;
    setHistoryIndex((prev) => prev + 1);
    return history[historyIndex + 1] || null;
  };

  return { history, historyIndex, saveToHistory, undo, redo };
}
