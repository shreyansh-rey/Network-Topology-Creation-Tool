import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { GraphCanvas } from './components/GraphCanvas';
import { DeviceList } from './components/DeviceList';
import { AlertsPanel } from './components/AlertsPanel';
import { AddDeviceForm } from './components/AddDeviceForm';
import { StatsBar } from './components/StatsBar';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { useTopology } from './hooks/useTopology';
import Login from './components/Login';

type View = 'dashboard' | 'devices' | 'alerts';

export default function App() {
  const { nodes, edges, alerts, loading, addLoading, backendConnected, fetchTopology, addDevice } = useTopology();
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const selectedNodeData = selectedNode ? nodes.find((n) => n.id === selectedNode) ?? null : null;

  useEffect(() => {
    fetch("http://localhost:5000/me", {
      credentials: "include"
    })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        setLoggedIn(true);
        setUsername(data.username);
      })
      .catch(() => setLoggedIn(false));
  }, []);  

  useEffect(() => {
    fetch("http://localhost:5000/", {
      credentials: "include"
    })
      .then(res => {
        if (res.ok) setLoggedIn(true);
        else setLoggedIn(false);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  if (loggedIn === null) {
    return <div className="text-white p-10">Checking session...</div>;
  }

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      <Navbar username={username} onLogout={() => setLoggedIn(false)} onRefresh={fetchTopology} loading={loading} backendConnected={backendConnected} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} alertCount={alerts.length} />

        <main className="flex-1 overflow-auto p-4 flex flex-col gap-4 min-w-0">
          {activeView === 'dashboard' && (
            <>
              <StatsBar nodes={nodes} edges={edges} />
              <AddDeviceForm onAdd={addDevice} loading={addLoading} />

              <div className="flex gap-4 flex-1 min-h-0 flex-col lg:flex-row">
                <div className="flex-1 min-h-96 lg:min-h-0 relative">
                  <GraphCanvas
                    nodes={nodes}
                    edges={edges}
                    selectedNode={selectedNode}
                    onSelectNode={setSelectedNode}
                  />
                  {selectedNodeData && (
                    <div className="absolute top-3 left-3 w-64">
                      <NodeDetailPanel
                        node={selectedNodeData}
                        edges={edges}
                        onClose={() => setSelectedNode(null)}
                      />
                    </div>
                  )}
                </div>

                <div className="lg:w-80 flex flex-col gap-3">
                  <DeviceList nodes={nodes} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
                  <AlertsPanel alerts={alerts} />
                </div>
              </div>
            </>
          )}

          {activeView === 'devices' && (
            <div className="flex flex-col gap-4 max-w-4xl">
              <div>
                <h2 className="text-white font-semibold text-lg mb-1">Device Management</h2>
                <p className="text-gray-500 text-sm">Manage and monitor all discovered network devices.</p>
              </div>
              <AddDeviceForm onAdd={addDevice} loading={addLoading} />
              <StatsBar nodes={nodes} edges={edges} />
              <DeviceList nodes={nodes} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
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
                  <span className="text-xs font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                    {alerts.length}
                  </span>
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
