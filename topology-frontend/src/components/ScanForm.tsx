import { useState } from 'react';
import { Radar, Loader2 } from 'lucide-react';

interface ScanFormProps {
  onScan: (cidr: string, onProgress?: (msg: string) => void) => Promise<{ found: number; added: number }>;
  loading: boolean;
  bare?: boolean;
}

export function ScanForm({ onScan, loading, bare }: ScanFormProps) {
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      const r = await onScan(cidr.trim(), setMsg);
      setMsg(`Found ${r.found} live, added ${r.added} new`);
    } catch (err) {
      setMsg(null);
      setError(err instanceof Error ? err.message : 'Scan failed');
    }
  };

  return (
    <div className={bare ? '' : 'bg-gray-900 border border-gray-800 rounded-lg p-4'}>
      {!bare && (
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Scan Network</h3>
      )}
      <p className="text-xs text-gray-600 mb-3">Ping sweep of a private range (/24 or smaller). New live hosts are added.</p>
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          placeholder="192.168.1.0/24"
          className="flex-1 bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          type="submit"
          disabled={loading || !cidr.trim()}
          className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-1.5 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
          Scan
        </button>
      </form>
      {msg && <div className={`mt-2 text-xs ${loading ? 'text-gray-400' : 'text-emerald-400'}`}>{msg}</div>}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}