import { useState } from 'react';

export function useLiveMode() {
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('idle');

  const startLiveMode = () => {
    setIsLiveMode(true);
    setRecordingStatus('recording');
  };
  const stopLiveMode = () => {
    setIsLiveMode(false);
    setRecordingStatus('idle');
  };

  return { isLiveMode, recordingStatus, startLiveMode, stopLiveMode };
}
