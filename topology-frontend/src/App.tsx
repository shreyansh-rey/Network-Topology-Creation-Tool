import { useCallback, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { GraphCanvas } from './components/GraphCanvas';
import { DeviceList } from './components/DeviceList';
import { AlertsPanel } from './components/AlertsPanel';
import { AddDeviceForm } from './components/AddDeviceForm';
import { ToolsPanel } from './components/ToolsPanel';
import { StatsBar } from './components/StatsBar';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { useTopology } from './hooks/useTopology';
import Login from './components/Login';
import { apiFetch, onUnauthorized, setCsrfToken } from './api';

type View = 'dashboard' | 'devices' | 'alerts';

export default function App() {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const { nodes, edges, alerts, loading, addLoading, backendConnected, pushConnected, fetchTopology, addDevice, scanNetwork, deleteDevice, savePositions, clearAlerts } =
    useTopology(loggedIn === true);

  const selectedNodeData = selectedNode ? nodes.find((n) => n.id === selectedNode) ?? null : null;

  const loadSession = useCallback(() => {
    return apiFetch('/me', { noAuthRedirect: true })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setCsrfToken(data.csrf || null);
        setLoggedIn(true);
        setUsername(data.username);
      })
      .catch(() => {
        setCsrfToken(null);
        setLoggedIn(false);
        setUsername(null);
      });
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // any API 401 (expired session) -> back to login
  useEffect(
    () =>
      onUnauthorized(() => {
        setLoggedIn(false);
        setUsername(null);
        setSelectedNode(null);
      }),
    []
  );

  const handleLogout = () => {
    setLoggedIn(false);
    setUsername(null);
    setSelectedNode(null);
  };

  const handleClearAlerts = async () => {
    if (!window.confirm('Clear all alerts?')) return;
    try {
      await clearAlerts();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to clear alerts');
    }
  };

  const handleDelete = async (ip: string) => {
    if (!window.confirm(`Delete device ${ip}?`)) return;
    try {
      await deleteDevice(ip);
      setSelectedNode((cur) => (cur === ip ? null : cur));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete device');
    }
  };

  if (loggedIn === null) {
    return <div className="text-white p-10">Checking session...</div>;
  }

  if (!loggedIn) {
    return <Login onLogin={loadSession} />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      <Navbar
        username={username}
        onLogout={handleLogout}
        onRefresh={fetchTopology}
        loading={loading}
        backendConnected={backendConnected}
        pushConnected={pushConnected}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} alertCount={alerts.length} />

        <main className="flex-1 overflow-auto p-4 flex flex-col gap-4 min-w-0">
          {activeView === 'dashboard' && (
            <>
              <StatsBar nodes={nodes} edges={edges} />

              <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest hidden sm:inline whitespace-nowrap">
                  Quick add
                </span>
                <div className="flex-1 min-w-0">
                  <AddDeviceForm bare onAdd={addDevice} loading={addLoading} />
                </div>
                <button
                  onClick={() => setActiveView('devices')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 whitespace-nowrap"
                >
                  Scan / SNMP tools
                </button>
              </div>

              <div className="flex gap-4 flex-1 min-h-[460px] flex-col lg:flex-row">
                <div className="flex-1 min-h-96 lg:min-h-0 relative">
                  <GraphCanvas
                    nodes={nodes}
                    edges={edges}
                    selectedNode={selectedNode}
                    onSelectNode={setSelectedNode}
                    onPositionsChange={savePositions}
                  />
                  {selectedNodeData && (
                    <div className="absolute top-3 left-3 w-64">
                      <NodeDetailPanel
                        node={selectedNodeData}
                        edges={edges}
                        onClose={() => setSelectedNode(null)}
                        onDelete={handleDelete}
                      />
                    </div>
                  )}
                </div>

                <div className="lg:w-80 flex flex-col gap-3">
                  <DeviceList nodes={nodes} selectedNode={selectedNode} onSelectNode={setSelectedNode} onDelete={handleDelete} />
                  <AlertsPanel alerts={alerts} onClear={handleClearAlerts} />
                </div>
              </div>
            </>
          )}

          {activeView === 'devices' && (
            <div className="flex flex-col gap-4 max-w-5xl">
              <div>
                <h2 className="text-white font-semibold text-lg mb-1">Device Management</h2>
                <p className="text-gray-500 text-sm">Add, discover and monitor network devices.</p>
              </div>
              <StatsBar nodes={nodes} edges={edges} />
              <ToolsPanel
                onAdd={addDevice}
                onScan={scanNetwork}
                onDiscoverDone={fetchTopology}
                loading={addLoading}
              />
              <DeviceList
                nodes={nodes}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                onDelete={handleDelete}
                maxHeight={520}
              />
            </div>
          )}

          {activeView === 'alerts' && (
            <div className="flex flex-col gap-4 max-w-2xl">
              <div>
                <h2 className="text-white font-semibold text-lg mb-1">Alerts</h2>
                <p className="text-gray-500 text-sm">Network events and topology change notifications.</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">All Events</h3>
                  <div className="flex items-center gap-2">
                    {alerts.length > 0 && (
                      <button
                        onClick={handleClearAlerts}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                    <span className="text-xs font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                      {alerts.length}
                    </span>
                  </div>
                </div>
                <div className="p-3 flex flex-col gap-2">
                  {alerts.map((alert) => {
                    const bgMap = { info: 'bg-sky-500/5 border-sky-500/15', warning: 'bg-amber-500/5 border-amber-500/15', error: 'bg-red-500/5 border-red-500/15' };
                    const textMap = { info: 'text-sky-400', warning: 'text-amber-400', error: 'text-red-400' };
                    const labelMap = { info: 'INFO', warning: 'WARN', error: 'ERROR' };
                    return (
                      <div key={alert.id} className={`flex items-start gap-3 px-3 py-3 rounded border ${bgMap[alert.type]}`}>
                        <span className={`text-xs font-mono font-semibold ${textMap[alert.type]} w-10 flex-shrink-0 mt-0.5`}>
                          {labelMap[alert.type]}
                        </span>
                        <div className="flex-1">
                          <p className="text-gray-300 text-sm">{alert.message}</p>
                          <p className="text-gray-600 text-xs mt-1 font-mono">
                            {alert.timestamp.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}