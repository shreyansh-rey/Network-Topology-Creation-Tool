import { NetworkNode } from '../types';
import { Router, Cpu, Monitor, HelpCircle } from 'lucide-react';

interface DeviceListProps {
  nodes: NetworkNode[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}

function DeviceIcon({ type }: { type: NetworkNode['type'] }) {
  switch (type) {
    case 'router': return <Router size={13} className="text-sky-400" />;
    case 'switch': return <Cpu size={13} className="text-emerald-400" />;
    case 'host': return <Monitor size={13} className="text-slate-400" />;
    default: return <HelpCircle size={13} className="text-gray-500" />;
  }
}

function typeLabel(type: NetworkNode['type']) {
  switch (type) {
    case 'router': return { label: 'Router', color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' };
    case 'switch': return { label: 'Switch', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
    case 'host': return { label: 'Host', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
    default: return { label: 'Unknown', color: 'text-gray-500 bg-gray-500/10 border-gray-500/20' };
  }
}

export function DeviceList({ nodes, selectedNode, onSelectNode }: DeviceListProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Devices</h3>
        <span className="text-xs font-mono text-cyan-500 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
          {nodes.length}
        </span>
      </div>
      <div className="overflow-y-auto flex-1" style={{ maxHeight: 280 }}>
        {nodes.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-600 text-sm">No devices discovered</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="text-gray-600 border-b border-gray-800">
                <th className="text-left px-4 py-2 font-medium">IP Address</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const isSelected = selectedNode === node.id;
                const { label, color } = typeLabel(node.type);
                return (
                  <tr
                    key={node.id}
                    onClick={() => onSelectNode(isSelected ? null : node.id)}
                    className={`
                      border-b border-gray-800/50 cursor-pointer transition-colors
                      ${isSelected ? 'bg-cyan-500/5 border-l-2 border-l-cyan-500' : 'hover:bg-gray-800/40'}
                    `}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <DeviceIcon type={node.type} />
                        <span className={`font-mono ${isSelected ? 'text-cyan-400' : 'text-gray-300'}`}>
                          {node.ip}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded border text-xs ${color}`}>{label}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${node.status === 'active' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                        <span className={node.status === 'active' ? 'text-emerald-400' : 'text-gray-500'}>
                          {node.status === 'active' ? 'Active' : 'Unknown'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
