import { useState } from 'react';
import { Radar, Loader2 } from 'lucide-react';

interface ScanFormProps {
  onScan: (cidr: string) => Promise<{ found: number; added: number }>;
  loading: boolean;
}

export function ScanForm({ onScan, loading }: ScanFormProps) {
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      const r = await onScan(cidr.trim());
      setMsg(`Found ${r.found} live, added ${r.added} new`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Scan Network</h3>
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          placeholder="192.168.1.0/24"
          className="flex-1 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          type="submit"
          disabled={loading || !cidr.trim()}
          className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
          Scan
        </button>
      </form>
      {msg && <div className="mt-2 text-xs text-emerald-400">{msg}</div>}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}