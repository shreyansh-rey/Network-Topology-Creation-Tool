import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { NetworkNode, NetworkEdge, Alert } from '../types';
import { apiFetch, errorMessage, API_BASE } from '../api';

const MAX_ALERTS = 100;

function guessDeviceType(ip?: string): NetworkNode['type'] {
  if (!ip) return 'unknown';
  const lastOctet = parseInt(ip.split('.').pop() || '0', 10);
  if (lastOctet === 1) return 'router';
  if (lastOctet >= 2 && lastOctet <= 5) return 'switch';
  return 'host';
}

const DUMMY_NODES: string[] = [
  '192.168.1.1',
  '192.168.1.2',
  '192.168.1.3',
  '192.168.1.10',
  '192.168.1.11',
  '10.0.0.1',
  '10.0.0.2',
];

const DUMMY_EDGES: [string, string][] = [
  ['192.168.1.1', '192.168.1.2'],
  ['192.168.1.1', '192.168.1.3'],
  ['192.168.1.2', '192.168.1.10'],
  ['192.168.1.2', '192.168.1.11'],
  ['192.168.1.1', '10.0.0.1'],
  ['10.0.0.1', '10.0.0.2'],
];

const DUMMY_ALERTS: Alert[] = [
  { id: '1', message: 'New device detected: 192.168.1.11', type: 'info', timestamp: new Date(Date.now() - 60000) },
  { id: '2', message: 'Topology changed: new edge detected', type: 'warning', timestamp: new Date(Date.now() - 180000) },
  { id: '3', message: 'Device 10.0.0.2 status unknown', type: 'warning', timestamp: new Date(Date.now() - 300000) },
  { id: '4', message: 'Scan complete on 192.168.1.0/24', type: 'info', timestamp: new Date(Date.now() - 600000) },
];

function buildNodes(rawNodes: any[]): NetworkNode[] {
  return rawNodes.map((node) => {
    if (typeof node === 'string') {
      return { id: node, ip: node, type: guessDeviceType(node), status: 'active' as const };
    }
    return {
      id: node.id || node.ip,
      ip: node.ip || node.id,
      type: node.type || guessDeviceType(node.ip),
      status: node.status || 'unknown',
      lastSeen: node.last_seen || null,
      x: typeof node.x === 'number' ? node.x : undefined,
      y: typeof node.y === 'number' ? node.y : undefined,
      name: node.name || null,
      descr: node.descr || null,
      snmp: !!node.snmp,
    };
  });
}

function buildEdges(rawEdges: [string, string, string?][]): NetworkEdge[] {
  return rawEdges.map(([source, target, kind]) => ({ source, target, kind }));
}

export function useTopology(enabled: boolean) {
  const [nodes, setNodes] = useState<NetworkNode[]>(buildNodes(DUMMY_NODES));
  const [edges, setEdges] = useState<NetworkEdge[]>(buildEdges(DUMMY_EDGES));
  const [alerts, setAlerts] = useState<Alert[]>(DUMMY_ALERTS);
  const [loading, setLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [pushConnected, setPushConnected] = useState(false);

  const fetchTopology = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('Bad response');
      const data = await res.json();
      setNodes(buildNodes(data.nodes || []));
      setEdges(buildEdges(data.edges || []));
      if (Array.isArray(data.alerts)) {
        setAlerts(
          data.alerts.map((a: { id: number | string; message: string; type?: Alert['type']; timestamp?: string }) => ({
            id: String(a.id),
            message: a.message,
            type: a.type || 'info',
            timestamp: a.timestamp ? new Date(a.timestamp) : new Date(),
          }))
        );
      }
      setBackendConnected(true);
    } catch {
      setBackendConnected(false);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const fetchRef = useRef(fetchTopology);
  useEffect(() => { fetchRef.current = fetchTopology; }, [fetchTopology]);

  // initial load
  useEffect(() => {
    if (!enabled) return;
    fetchTopology();
  }, [enabled, fetchTopology]);

  // safety-net polling: slow while push channel is up, fast when it is down
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(fetchTopology, pushConnected ? 120000 : 15000);
    return () => clearInterval(interval);
  }, [enabled, fetchTopology, pushConnected]);

  // push channel
  useEffect(() => {
    if (!enabled) return;
    const socket: Socket = io(API_BASE, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    let debounce: number | undefined;

    socket.on('connect', () => {
      setPushConnected(true);
      fetchRef.current(); // catch up on anything missed while offline
    });
    socket.on('disconnect', () => setPushConnected(false));
    socket.on('connect_error', () => setPushConnected(false));

    socket.on('topology', () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => fetchRef.current(), 300);
    });

    socket.on('alert', (a: { id: number | string; message: string; type?: Alert['type']; timestamp?: string }) => {
      const id = String(a.id);
      setAlerts((prev) =>
        prev.some((x) => x.id === id)
          ? prev
          : [
              {
                id,
                message: a.message,
                type: a.type || 'info',
                timestamp: a.timestamp ? new Date(a.timestamp) : new Date(),
              },
              ...prev,
            ].slice(0, MAX_ALERTS)
      );
    });

    return () => {
      window.clearTimeout(debounce);
      socket.disconnect();
      setPushConnected(false);
    };
  }, [enabled]);

  const addDevice = useCallback(async (ip: string) => {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      throw new Error('Invalid IP address format');
    }
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) {
      throw new Error('Invalid IP address: octet out of range');
    }
    if (parts[3] === 0 || parts[3] === 255) {
      throw new Error('Invalid host address');
    }
    if (nodes.some((n) => n.ip === ip)) {
      throw new Error('Device already exists in topology');
    }

    setAddLoading(true);
    try {
      if (backendConnected) {
        const res = await apiFetch('/add', {
          method: 'POST',
          json: { ip },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error(await errorMessage(res, 'Failed to add device'));
        await fetchTopology();
      } else {
        const newNode: NetworkNode = {
          id: ip,
          ip,
          type: guessDeviceType(ip),
          status: 'active',
        };
        setNodes((prev) => [...prev, newNode]);
        const alert: Alert = {
          id: Date.now().toString(),
          message: `New device added: ${ip}`,
          type: 'info',
          timestamp: new Date(),
        };
        setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS));
      }
    } finally {
      setAddLoading(false);
    }
  }, [nodes, backendConnected, fetchTopology]);

  const scanNetwork = useCallback(async (cidr: string, onProgress?: (msg: string) => void) => {
    setAddLoading(true);
    try {
      const res = await apiFetch('/scan', { method: 'POST', json: { cidr } });
      if (!res.ok) throw new Error(await errorMessage(res, 'Scan failed'));

      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const sres = await apiFetch('/scan/status');
        if (!sres.ok) throw new Error(await errorMessage(sres, 'Scan status failed'));
        const data = await sres.json();
        if (data.status === 'running') {
          onProgress?.(data.message || 'Scanning...');
          continue;
        }
        if (data.status !== 'done') throw new Error(data.error || 'Scan failed');
        await fetchTopology();
        return { found: data.found as number, added: data.added as number };
      }
    } finally {
      setAddLoading(false);
    }
  }, [fetchTopology]);

  const deleteDevice = useCallback(async (ip: string) => {
    if (backendConnected) {
      const res = await apiFetch('/delete', {
        method: 'POST',
        json: { ip },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to delete device'));
      await fetchTopology();
    } else {
      setNodes((prev) => prev.filter((n) => n.ip !== ip));
      setEdges((prev) => prev.filter((e) => e.source !== ip && e.target !== ip));
    }
  }, [backendConnected, fetchTopology]);

  const savePositions = useCallback((positions: Record<string, { x: number; y: number }>) => {
    if (!backendConnected) return;
    apiFetch('/positions', { method: 'POST', json: { positions } }).catch(() => {});
  }, [backendConnected]);

  const clearAlerts = useCallback(async () => {
    if (backendConnected) {
      const res = await apiFetch('/alerts/clear', { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to clear alerts'));
    }
    setAlerts([]);
  }, [backendConnected]);

  return { nodes, edges, alerts, loading, addLoading, error, backendConnected, pushConnected, fetchTopology, addDevice, scanNetwork, deleteDevice, savePositions, clearAlerts };
}