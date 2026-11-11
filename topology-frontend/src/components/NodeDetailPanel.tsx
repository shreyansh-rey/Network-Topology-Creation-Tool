import { NetworkNode, NetworkEdge } from '../types';
import { X, Router, Cpu, Monitor, Trash2 } from 'lucide-react';

interface NodeDetailPanelProps {
  node: NetworkNode | null;
  edges: NetworkEdge[];
  onClose: () => void;
  onDelete?: (ip: string) => void;
}

function DeviceIcon({ type }: { type: NetworkNode['type'] }) {
  switch (type) {
    case 'router': return <Router size={16} className="text-sky-400" />;
    case 'switch': return <Cpu size={16} className="text-emerald-400" />;
    default: return <Monitor size={16} className="text-slate-400" />;
  }
}

export function NodeDetailPanel({ node, edges, onClose, onDelete }: NodeDetailPanelProps) {
  if (!node) return null;

  const dot = node.status === 'active' ? 'bg-emerald-400' : node.status === 'down' ? 'bg-red-500' : 'bg-gray-500';
  const text = node.status === 'active' ? 'text-emerald-400' : node.status === 'down' ? 'text-red-400' : 'text-gray-500';

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
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            <span className={`text-xs capitalize ${text}`}>{node.status}</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-800/60 rounded p-2 mb-3">
        <div className="text-gray-500 text-xs mb-0.5">Last seen</div>
        <div className="text-gray-200 text-xs">
          {node.lastSeen ? new Date(node.lastSeen).toLocaleString() : 'Never'}
        </div>
      </div>
      {(node.name || node.descr) && (
        <div className="bg-gray-800/60 rounded p-2 mb-3">
          {node.name && (
            <>
              <div className="text-gray-500 text-xs mb-0.5">Name</div>
              <div className="text-gray-200 text-xs mb-1.5 break-all">{node.name}</div>
            </>
          )}
          {node.descr && (
            <>
              <div className="text-gray-500 text-xs mb-0.5">Description</div>
              <div className="text-gray-400 text-xs line-clamp-3 break-words" title={node.descr}>{node.descr}</div>
            </>
          )}
        </div>
      )}
      {connected.length > 0 && (
        <div className="mb-3">
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
      {onDelete && (
        <button
          onClick={() => onDelete(node.ip)}
          className="w-full flex items-center justify-center gap-2 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded px-3 py-1.5 transition-colors"
        >
          <Trash2 size={12} />
          Delete device
        </button>
      )}
    </div>
  );
}