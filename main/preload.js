const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('finch', {
  list: (q) => ipcRenderer.invoke('notes:list', q),
  read: (id) => ipcRenderer.invoke('notes:read', id),
  write: (id, text) => ipcRenderer.invoke('notes:write', id, text),
  writeSync: (id, text) => ipcRenderer.sendSync('notes:writeSync', id, text),
  create: (text) => ipcRenderer.invoke('notes:create', text),
  discardIfEmpty: (id) => ipcRenderer.invoke('notes:discardIfEmpty', id),
  trash: (id) => ipcRenderer.invoke('notes:trash', id),
  pin: (id, pinned) => ipcRenderer.invoke('notes:pin', id, pinned),
  saveImage: (bytes, ext) => ipcRenderer.invoke('notes:saveImage', bytes, ext),
  pickImage: () => ipcRenderer.invoke('notes:pickImage'),
  exportPdf: (opts) => ipcRenderer.invoke('pdf:export', opts),
  open: (p) => ipcRenderer.invoke('shell:open', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder'),
  info: () => ipcRenderer.invoke('app:info'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
