import { useState } from 'react';
import { API_BASE_URL, authenticatedFetch } from '../../../config/api';

export function useVersionHistory(getToken, flowId) {
  const [versions, setVersions] = useState([]);

  const fetchVersionHistory = async () => {
    if (!flowId) return;
    const res = await authenticatedFetch(`${API_BASE_URL}/api/process-flows/${flowId}/versions`, { method: 'GET' }, getToken);
    if (res.ok) setVersions(await res.json());
  };

  const handleRestoreVersion = async () => {
    // Placeholder for core mode.
  };

  return { versions, fetchVersionHistory, handleRestoreVersion };
}
