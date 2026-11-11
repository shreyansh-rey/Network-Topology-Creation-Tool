export interface NetworkNode {
  id: string;
  ip: string;
  type: 'router' | 'switch' | 'host' | 'unknown';
  status: 'active' | 'down' | 'unknown';
  lastSeen?: string | null;
  name?: string | null;
  descr?: string | null;
  snmp?: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
  kind?: string; // lldp | cdp | fdb | arp | manual | inferred
}

export interface Alert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error';
  timestamp: Date;
}