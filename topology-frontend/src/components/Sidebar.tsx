import { LayoutDashboard, Monitor, Bell, Shield } from 'lucide-react';

type View = 'dashboard' | 'devices' | 'alerts';

interface SidebarProps {
  activeView: View;
  onViewChange: (view: View) => void;
  alertCount: number;
}

const navItems: { id: View; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'devices', label: 'Devices', icon: Monitor },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

export function Sidebar({ activeView, onViewChange, alertCount }: SidebarProps) {
  return (
    <aside className="w-14 sm:w-48 bg-gray-950 border-r border-gray-800 flex flex-col py-4 flex-shrink-0">
      <div className="px-2 sm:px-3 mb-4 hidden sm:block">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Shield size={12} className="text-gray-600" />
          <span className="text-gray-600 text-xs font-medium uppercase tracking-widest">Navigation</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => onViewChange(id)}
              className={`
                flex items-center gap-3 px-2 py-2.5 rounded-md text-sm font-medium transition-all group
                ${isActive
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60 border border-transparent'
                }
              `}
            >
              <Icon size={16} className={isActive ? 'text-cyan-400' : 'text-gray-500 group-hover:text-gray-300'} />
              <span className="hidden sm:inline">{label}</span>
              {id === 'alerts' && alertCount > 0 && (
                <span className="ml-auto hidden sm:flex bg-amber-500/20 text-amber-400 text-xs rounded-full px-1.5 py-0.5 min-w-5 justify-center border border-amber-500/20">
                  {alertCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-3 hidden sm:block">
        <div className="border-t border-gray-800 pt-3">
          <p className="text-gray-700 text-xs leading-relaxed">
            SANCTT v1.0<br />
            <span className="text-gray-800">Secure Auto Network<br />Topology Creation Tool</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
