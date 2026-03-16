export function useFlowExport() {
  const downloadJSON = (nodes, edges) => {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'process_flow.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = async () => {
    // Placeholder in core mode.
  };

  return { downloadJSON, downloadPNG };
}
