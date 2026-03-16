import { useState } from 'react';

export function useSop() {
  const [sopStatus, setSopStatus] = useState('idle');
  const generateSOP = async () => setSopStatus('ready');
  const removeSOP = async () => setSopStatus('idle');
  return { sopStatus, generateSOP, removeSOP };
}
