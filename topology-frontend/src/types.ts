export interface NetworkNode {
  id: string;
  ip: string;
  type: 'router' | 'switch' | 'host' | 'unknown';
  status: 'active' | 'unknown';
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
}

export interface TopologyData {
  nodes: string[];
  edges: [string, string][];
}

export interface Alert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error';
  timestamp: Date;
}
