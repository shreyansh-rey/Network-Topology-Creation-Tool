import { NetworkNode, NetworkEdge } from '../types';
import { Activity, Link2, Server, GitBranch } from 'lucide-react';

interface StatsBarProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export function StatsBar({ nodes, edges }: StatsBarProps) {
  const routers = nodes.filter((n) => n.type === 'router').length;
  const switches = nodes.filter((n) => n.type === 'switch').length;
  const hosts = nodes.filter((n) => n.type === 'host').length;

  const stats = [
    { label: 'Total Devices', value: nodes.length, icon: Server, color: 'text-cyan-400' },
    { label: 'Connections', value: edges.length, icon: Link2, color: 'text-sky-400' },
    { label: 'Routers', value: routers, icon: GitBranch, color: 'text-sky-400' },
    { label: 'Switches / Hosts', value: `${switches} / ${hosts}`, icon: Activity, color: 'text-emerald-400' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center gap-3">
          <div className="p-1.5 rounded bg-gray-800">
            <Icon size={14} className={color} />
          </div>
          <div>
            <div className={`text-lg font-semibold font-mono ${color}`}>{value}</div>
            <div className="text-gray-600 text-xs">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
