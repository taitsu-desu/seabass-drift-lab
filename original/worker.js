importScripts('sim.js');
self.onmessage = (e) => {
  const r = self.DriftSim.simulate(e.data.cfg);
  self.postMessage({ id: e.data.id, r });
};
