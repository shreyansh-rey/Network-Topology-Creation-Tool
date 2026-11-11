import { useState } from 'react';
import { Plus, Loader2, AlertCircle } from 'lucide-react';

interface AddDeviceFormProps {
  onAdd: (ip: string) => Promise<void>;
  loading: boolean;
  /** no card chrome or title, for use inside another container */
  bare?: boolean;
}

export function AddDeviceForm({ onAdd, loading, bare }: AddDeviceFormProps) {
  const [ip, setIp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const trimmed = ip.trim();
    if (!trimmed) return;
    try {
      await onAdd(trimmed);
      setIp('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add device');
    }
  };

  return (
    <div className={bare ? '' : 'bg-gray-900 border border-gray-800 rounded-lg p-4'}>
      {!bare && (
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Add Device</h3>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={ip}
          onChange={(e) => { setIp(e.target.value); setError(null); }}
          placeholder="Device IP, e.g. 192.168.1.50"
          className={`
            flex-1 min-w-0 bg-gray-950 border rounded px-3 py-1.5 text-sm font-mono text-white placeholder-gray-600
            focus:outline-none focus:ring-1 transition-colors
            ${error ? 'border-red-500/60 focus:ring-red-500/30' : 'border-gray-700 focus:border-cyan-500/50 focus:ring-cyan-500/20'}
            ${success ? 'border-emerald-500/60' : ''}
          `}
        />
        <button
          type="submit"
          disabled={loading || !ip.trim()}
          className="flex items-center justify-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:border-cyan-500/50 px-4 py-1.5 rounded text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </form>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      {success && <div className="mt-2 text-xs text-emerald-400">Device added</div>}
    </div>
  );
}