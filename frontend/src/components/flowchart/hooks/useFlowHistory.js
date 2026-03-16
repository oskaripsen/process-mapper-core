import { useCallback, useEffect, useRef, useState } from 'react';

export const useFlowHistory = ({ setNodes, setEdges }) => {
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const saveToHistory = useCallback((newNodes, newEdges) => {
    const newState = {
      nodes: JSON.parse(JSON.stringify(newNodes)),
      edges: JSON.parse(JSON.stringify(newEdges)),
      timestamp: Date.now()
    };

    const currentHistory = historyRef.current;
    const currentIndex = historyIndexRef.current;

    // Remove any history after current index (when user makes new changes after undo)
    const newHistory = currentHistory.slice(0, currentIndex + 1);
    newHistory.push(newState);

    // Limit history to 50 states to prevent memory issues
    if (newHistory.length > 50) {
      newHistory.shift();
    }

    const nextIndex = newHistory.length - 1;
    historyRef.current = newHistory;
    historyIndexRef.current = nextIndex;
    setHistory(newHistory);
    setHistoryIndex(nextIndex);
  }, []);

  const undo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    const currentHistory = historyRef.current;
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      const state = currentHistory[newIndex];
      setNodes(state.nodes);
      setEdges(state.edges);
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
    }
  }, [setEdges, setNodes]);

  const redo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    const currentHistory = historyRef.current;
    if (currentIndex < currentHistory.length - 1) {
      const newIndex = currentIndex + 1;
      const state = currentHistory[newIndex];
      setNodes(state.nodes);
      setEdges(state.edges);
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
    }
  }, [setEdges, setNodes]);

  return {
    history,
    setHistory,
    historyIndex,
    setHistoryIndex,
    saveToHistory,
    undo,
    redo,
  };
};
