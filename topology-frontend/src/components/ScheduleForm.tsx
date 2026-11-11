import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Trash2, Plus } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';

interface Schedule {
  id: number;
  cidr: string;
  interval_minutes: number;
  enabled: boolean;
  last_run: string | null;
  last_found: number | null;
  last_added: number | null;
}

const INTERVALS = [
  { v: 5, label: '5 min' },
  { v: 15, label: '15 min' },
  { v: 30, label: '30 min' },
  { v: 60, label: '1 hour' },
  { v: 360, label: '6 hours' },
  { v: 1440, label: '24 hours' },
];

function intervalLabel(m: number) {
  return INTERVALS.find((i) => i.v === m)?.label ?? `${m} min`;
}

export function ScheduleForm({ bare }: { bare?: boolean }) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const [interval, setIntervalMin] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/schedules');
      if (res.ok) setItems(await res.json());
    } catch {
      // backend offline: list stays empty
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // refresh last-run info
    return () => clearInterval(t);
  }, [load]);

  const call = async (path: string, json: unknown, fallback: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(path, { method: 'POST', json });
      if (!res.ok) throw new Error(await errorMessage(res, fallback));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    call('/schedules', { cidr: cidr.trim(), interval_minutes: interval }, 'Failed to add schedule');
  };

  return (
    <div className={bare ? '' : 'bg-gray-900 border border-gray-800 rounded-lg p-4'}>
      {!bare && (
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Scheduled Scans</h3>
      )}
      <p className="text-xs text-gray-600 mb-3">
        Ping sweep runs in background. New devices are added and raise an alert.
      </p>

      <form onSubmit={add} className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          placeholder="192.168.1.0/24"
          className="flex-1 bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
        />
        <select
          value={interval}
          onChange={(e) => setIntervalMin(Number(e.target.value))}
          className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
        >
          {INTERVALS.map((i) => (
            <option key={i.v} value={i.v}>
              Every {i.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !cidr.trim()}
          className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-1.5 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <Plus size={14} />
          Add
        </button>
      </form>

      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

      {items.length === 0 ? (
        <div className="text-xs text-gray-600">No schedules</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 bg-gray-950 border border-gray-800 rounded px-3 py-2"
            >
              <CalendarClock size={14} className={s.enabled ? 'text-cyan-400' : 'text-gray-600'} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono text-gray-200">
                  {s.cidr} <span className="text-gray-500 text-xs">every {intervalLabel(s.interval_minutes)}</span>
                </div>
                <div className="text-xs text-gray-600">
                  {s.last_run
                    ? `Last run ${new Date(s.last_run).toLocaleString()}: ${s.last_found ?? '-'} live, ${s.last_added ?? '-'} new`
                    : 'Not run yet'}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  disabled={busy}
                  onChange={(e) => call('/schedules/toggle', { id: s.id, enabled: e.target.checked }, 'Failed to update')}
                />
                On
              </label>
              <button
                onClick={() => call('/schedules/delete', { id: s.id }, 'Failed to delete')}
                disabled={busy}
                className="text-gray-600 hover:text-red-400 transition-colors"
                title="Delete schedule"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}