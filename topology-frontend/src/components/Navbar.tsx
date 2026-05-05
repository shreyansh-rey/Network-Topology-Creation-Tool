import { Network, User, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface NavbarProps {
  onRefresh: () => void;
  loading: boolean;
  backendConnected: boolean;
}

export function Navbar({ onRefresh, loading, backendConnected }: NavbarProps) {
  return (
    <header className="h-14 bg-gray-950 border-b border-gray-800 flex items-center px-6 justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded bg-cyan-500/10 border border-cyan-500/30">
          <Network size={18} className="text-cyan-400" />
        </div>
        <div>
          <span className="text-white font-semibold text-sm tracking-wide">Topology Dashboard</span>
          <span className="ml-2 text-gray-500 text-xs hidden sm:inline">SCADA Network Monitor</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs">
          {backendConnected ? (
            <>
              <Wifi size={13} className="text-emerald-400" />
              <span className="text-emerald-400">Live</span>
            </>
          ) : (
            <>
              <WifiOff size={13} className="text-amber-400" />
              <span className="text-amber-400">Demo Mode</span>
            </>
          )}
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
          title="Refresh topology"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>

        <div className="h-4 w-px bg-gray-800" />

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <User size={13} className="text-gray-400" />
          </div>
          <span className="text-gray-400 text-xs hidden sm:inline">analyst</span>
        </div>
      </div>
    </header>
  );
}
