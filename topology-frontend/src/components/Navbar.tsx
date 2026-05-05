import { Network, User, RefreshCw, Wifi, WifiOff, LogOut } from 'lucide-react';
import { useState } from 'react';

interface NavbarProps {
  username: string | null;
  onLogout: () => void;
  onRefresh: () => void;
  loading: boolean;
  backendConnected: boolean;
}

export function Navbar({ username, onLogout, onRefresh, loading, backendConnected }: NavbarProps) {
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await fetch("http://localhost:5000/logout", {
      method: "POST",
      credentials: "include"
    });

    onLogout();
  };  

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

        <div className="relative">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <User size={13} className="text-gray-400" />
            </div>
            <span className="text-gray-400 text-xs hidden sm:inline">
              {username?.charAt(0).toUpperCase() || "User"}
            </span>
          </div>

          {open && (
            <div className="absolute right-0 mt-2 w-36 bg-gray-900 border border-gray-800 rounded-lg shadow-lg z-50">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
