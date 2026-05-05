import { NetworkNode, NetworkEdge } from '../types';
import { X, Router, Cpu, Monitor } from 'lucide-react';

interface NodeDetailPanelProps {
  node: NetworkNode | null;
  edges: NetworkEdge[];
  onClose: () => void;
}

function DeviceIcon({ type }: { type: NetworkNode['type'] }) {
  switch (type) {
    case 'router': return <Router size={16} className="text-sky-400" />;
    case 'switch': return <Cpu size={16} className="text-emerald-400" />;
    default: return <Monitor size={16} className="text-slate-400" />;
  }
}

export function NodeDetailPanel({ node, edges, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  const connected = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => (e.source === node.id ? e.target : e.source));

  return (
    <div className="bg-gray-900 border border-cyan-500/20 rounded-lg p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DeviceIcon type={node.type} />
          <span className="text-white font-medium font-mono">{node.ip}</span>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-gray-800/60 rounded p-2">
          <div className="text-gray-500 text-xs mb-0.5">Type</div>
          <div className="text-gray-200 text-xs capitalize">{node.type}</div>
        </div>
        <div className="bg-gray-800/60 rounded p-2">
          <div className="text-gray-500 text-xs mb-0.5">Status</div>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-emerald-400 text-xs capitalize">{node.status}</span>
          </div>
        </div>
      </div>
      {connected.length > 0 && (
        <div>
          <div className="text-gray-500 text-xs mb-1.5">Connected to</div>
          <div className="flex flex-wrap gap-1">
            {connected.map((ip) => (
              <span key={ip} className="font-mono text-xs bg-gray-800 border border-gray-700 text-gray-300 px-2 py-0.5 rounded">
                {ip}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
