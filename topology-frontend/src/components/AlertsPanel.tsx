import { Alert } from '../types';
import { Info, AlertTriangle, AlertCircle } from 'lucide-react';

interface AlertsPanelProps {
  alerts: Alert[];
}

function formatTime(date: Date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function AlertIcon({ type }: { type: Alert['type'] }) {
  switch (type) {
    case 'info': return <Info size={13} className="text-sky-400 flex-shrink-0" />;
    case 'warning': return <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />;
    case 'error': return <AlertCircle size={13} className="text-red-400 flex-shrink-0" />;
  }
}

const alertBg: Record<Alert['type'], string> = {
  info: 'bg-sky-500/5 border-sky-500/15',
  warning: 'bg-amber-500/5 border-amber-500/15',
  error: 'bg-red-500/5 border-red-500/15',
};

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Alerts</h3>
        <span className="text-xs font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
          {alerts.length}
        </span>
      </div>
      <div className="overflow-y-auto flex-1 p-2 flex flex-col gap-1.5" style={{ maxHeight: 220 }}>
        {alerts.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-600 text-sm">No alerts</div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className={`flex items-start gap-2.5 px-3 py-2.5 rounded border ${alertBg[alert.type]}`}>
              <AlertIcon type={alert.type} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-300 text-xs leading-relaxed">{alert.message}</p>
                <p className="text-gray-600 text-xs mt-0.5 font-mono">{formatTime(alert.timestamp)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
