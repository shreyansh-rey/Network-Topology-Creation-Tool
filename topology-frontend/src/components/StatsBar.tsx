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
  const down = nodes.filter((n) => n.status === 'down').length;

  const stats = [
    { label: 'Devices', value: nodes.length, icon: Server, color: 'text-cyan-400' },
    { label: 'Links', value: edges.length, icon: Link2, color: 'text-sky-400' },
    { label: 'Routers', value: routers, icon: GitBranch, color: 'text-sky-400' },
    { label: 'Switches / Hosts', value: `${switches} / ${hosts}`, icon: Activity, color: 'text-emerald-400' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex items-center gap-2.5">
          <div className="p-1 rounded bg-gray-800">
            <Icon size={13} className={color} />
          </div>
          <div className="min-w-0">
            <div className={`text-base leading-tight font-semibold font-mono ${color}`}>{value}</div>
            <div className="text-gray-600 text-xs leading-tight truncate">
              {label}
              {label === 'Devices' && down > 0 && <span className="text-red-400 ml-1">({down} down)</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}