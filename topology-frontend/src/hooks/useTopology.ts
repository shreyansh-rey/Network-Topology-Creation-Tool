import { useState, useEffect, useCallback } from 'react';
import { NetworkNode, NetworkEdge, Alert } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

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
  return rawNodes.map((node) => ({
    id: node.id || node.ip,
    ip: node.ip || node.id,
    type: node.type || guessDeviceType(node.ip),
    status: node.status || 'active',
  }));
}

function buildEdges(rawEdges: [string, string][]): NetworkEdge[] {
  return rawEdges.map(([source, target]) => ({ source, target }));
}

export function useTopology() {
  const [nodes, setNodes] = useState<NetworkNode[]>(buildNodes(DUMMY_NODES));
  const [edges, setEdges] = useState<NetworkEdge[]>(buildEdges(DUMMY_EDGES));
  const [alerts, setAlerts] = useState<Alert[]>(DUMMY_ALERTS);
  const [loading, setLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);

  const fetchTopology = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/`, {
        credentials: "include",
        signal: AbortSignal.timeout(4000) 
      });
      if (!res.ok) throw new Error('Bad response');
      const data = await res.json();
      setNodes(buildNodes(data.nodes || []));
      setEdges(buildEdges(data.edges || []));
      if (data.alerts) {
        const newAlerts = data.alerts.map((msg: string) => ({
          id: Date.now().toString() + Math.random(),
          message: msg,
          type: 'warning',
          timestamp: new Date(),
        }));
      
        setAlerts((prev) => [...newAlerts, ...prev]);
      }      
      setBackendConnected(true);
    } catch {
      setBackendConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopology();
    const interval = setInterval(fetchTopology, 15000);
    return () => clearInterval(interval);
  }, [fetchTopology]);

  const addDevice = useCallback(async (ip: string) => {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      throw new Error('Invalid IP address format');
    }
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) {
      throw new Error('Invalid IP address: octet out of range');
    }
    if (nodes.some((n) => n.ip === ip)) {
      throw new Error('Device already exists in topology');
    }

    setAddLoading(true);
    try {
      if (backendConnected) {
        const res = await fetch(`${API_BASE}/add`, {
          credentials: "include",
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error('Failed to add device');
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
        setAlerts((prev) => [alert, ...prev]);
      }
    } finally {
      setAddLoading(false);
    }
  }, [nodes, backendConnected, fetchTopology]);

  return { nodes, edges, alerts, loading, addLoading, error, backendConnected, fetchTopology, addDevice };
}
