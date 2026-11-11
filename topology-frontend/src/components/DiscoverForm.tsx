import { useState, useRef, useEffect, useCallback } from 'react';
import { Network, Loader2 } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';

interface DiscoverFormProps {
  onDone: () => void;
  /** no card chrome or title, for use inside another container */
  bare?: boolean;
}

const inputCls =
  'w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50';
const labelCls = 'block text-xs text-gray-500 mb-1';

export function DiscoverForm({ onDone, bare }: DiscoverFormProps) {
  const [seed, setSeed] = useState('');
  const [version, setVersion] = useState<'2c' | '3'>('3');
  const [community, setCommunity] = useState('');
  const [username, setUsername] = useState('');
  const [authProtocol, setAuthProtocol] = useState('SHA');
  const [authKey, setAuthKey] = useState('');
  const [privProtocol, setPrivProtocol] = useState('AES');
  const [privKey, setPrivKey] = useState('');

  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async (initial = false) => {
    try {
      const res = await apiFetch('/discover/status');
      if (!res.ok) throw new Error(await errorMessage(res, 'Status check failed'));
      const data = await res.json();
      if (data.status === 'running') {
        setRunning(true);
        setMsg(data.message || 'Running...');
        timer.current = window.setTimeout(() => poll(), 1500);
      } else if (initial) {
        // page load: ignore finished jobs from earlier
        setRunning(false);
      } else if (data.status === 'done') {
        setRunning(false);
        setMsg(data.message);
        onDone();
      } else if (data.status === 'error') {
        setRunning(false);
        setMsg(null);
        setError(data.error || 'Discovery failed');
      } else {
        setRunning(false);
      }
    } catch (err) {
      setRunning(false);
      if (!initial) setError(err instanceof Error ? err.message : 'Status check failed');
    }
  }, [onDone]);

  // resume progress display if a job is already running
  useEffect(() => {
    poll(true);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [poll]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    const body =
      version === '2c'
        ? { seed: seed.trim(), version, community }
        : {
            seed: seed.trim(),
            version,
            username,
            auth_protocol: authProtocol,
            auth_key: authKey,
            priv_protocol: privProtocol,
            priv_key: privKey,
          };

    try {
      const res = await apiFetch('/discover', { method: 'POST', json: body });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to start discovery'));
      setRunning(true);
      setMsg('Starting...');
      timer.current = window.setTimeout(() => poll(), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start discovery');
    }
  };

  const canSubmit = !running && seed.trim() && (version === '2c' ? community : username);

  return (
    <div className={bare ? '' : 'bg-gray-900 border border-gray-800 rounded-lg p-4'}>
      {!bare && (
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">SNMP Discovery</h3>
      )}
      <p className="text-xs text-gray-600 mb-3">
        Start from one router or switch. Follows LLDP/CDP neighbors and reads ARP and MAC tables for real links.
        Credentials are used once, never stored.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="lg:col-span-2">
            <label className={labelCls}>Seed device IP</label>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="192.168.1.1"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>SNMP version</label>
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value as '2c' | '3')}
              className={inputCls}
            >
              <option value="3">v3 (recommended)</option>
              <option value="2c">v2c</option>
            </select>
          </div>
          <div>
            {version === '2c' ? (
              <>
                <label className={labelCls}>Community string</label>
                <input
                  type="password"
                  autoComplete="off"
                  value={community}
                  onChange={(e) => setCommunity(e.target.value)}
                  className={inputCls}
                />
              </>
            ) : (
              <>
                <label className={labelCls}>Username</label>
                <input
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputCls}
                />
              </>
            )}
          </div>
        </div>

        {version === '3' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <label className={labelCls}>Auth protocol</label>
              <select value={authProtocol} onChange={(e) => setAuthProtocol(e.target.value)} className={inputCls}>
                <option value="SHA">SHA</option>
                <option value="SHA256">SHA-256</option>
                <option value="MD5">MD5</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Auth key (8+ chars)</label>
              <input
                type="password"
                autoComplete="off"
                value={authKey}
                onChange={(e) => setAuthKey(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Privacy protocol</label>
              <select value={privProtocol} onChange={(e) => setPrivProtocol(e.target.value)} className={inputCls}>
                <option value="AES">AES-128</option>
                <option value="AES256">AES-256</option>
                <option value="DES">DES</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Privacy key (8+ chars)</label>
              <input
                type="password"
                autoComplete="off"
                value={privKey}
                onChange={(e) => setPrivKey(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-500/80">v2c sends the community in clear text. Use only on a trusted network.</p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-1.5 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Network size={14} />}
            {running ? 'Discovering...' : 'Discover'}
          </button>
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </form>
    </div>
  );
}