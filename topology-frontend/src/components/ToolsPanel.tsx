import { useState } from 'react';
import { Plus, Radar, Network, CalendarClock } from 'lucide-react';
import { AddDeviceForm } from './AddDeviceForm';
import { ScanForm } from './ScanForm';
import { DiscoverForm } from './DiscoverForm';
import { ScheduleForm } from './ScheduleForm';

type Tab = 'add' | 'scan' | 'snmp' | 'schedule';

interface ToolsPanelProps {
  onAdd: (ip: string) => Promise<void>;
  onScan: (cidr: string, onProgress?: (msg: string) => void) => Promise<{ found: number; added: number }>;
  onDiscoverDone: () => void;
  loading: boolean;
}

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'add', label: 'Add device', icon: Plus },
  { id: 'scan', label: 'Ping scan', icon: Radar },
  { id: 'snmp', label: 'SNMP discovery', icon: Network },
  { id: 'schedule', label: 'Scheduled scans', icon: CalendarClock },
];

export function ToolsPanel({ onAdd, onScan, onDiscoverDone, loading }: ToolsPanelProps) {
  const [tab, setTab] = useState<Tab>('add');

  // all tabs stay mounted (hidden) so running jobs and typed values survive tab switches
  const pane = (id: Tab) => (tab === id ? '' : 'hidden');

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      <div className="flex gap-1 border-b border-gray-800 px-2 overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        <div className={pane('add')}>
          <AddDeviceForm bare onAdd={onAdd} loading={loading} />
        </div>
        <div className={pane('scan')}>
          <ScanForm bare onScan={onScan} loading={loading} />
        </div>
        <div className={pane('snmp')}>
          <DiscoverForm bare onDone={onDiscoverDone} />
        </div>
        <div className={pane('schedule')}>
          <ScheduleForm bare />
        </div>
      </div>
    </div>
  );
}