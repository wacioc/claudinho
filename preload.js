const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (name, ...args) => ipcRenderer.invoke('rpc', name, ...args),
  write: (id, data) => ipcRenderer.send('pty-write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty-resize', id, cols, rows),
  on: (channel, fn) => {
    if (['state', 'pty-data', 'config-changed'].includes(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
