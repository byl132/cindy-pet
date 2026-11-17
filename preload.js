const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
contextBridge.exposeInMainWorld('pet', {
  asset: (name) => fs.readFileSync(path.join(__dirname, 'assets', name)),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (p) => ipcRenderer.invoke('config:set', p),
  patchState: (p) => ipcRenderer.invoke('state:patch', p),
  chat: (messages) => ipcRenderer.invoke('chat:send', { messages }),
  info: () => ipcRenderer.invoke('win:info'),
  setPos: (x, y) => ipcRenderer.send('win:pos', x, y),
  dragStart: (t) => ipcRenderer.send('drag:start', t),
  dragEnd: () => ipcRenderer.invoke('drag:end'),
  ignore: (v) => ipcRenderer.send('win:ignore', v),
  focus: () => ipcRenderer.send('win:focus'),
  menu: () => ipcRenderer.send('menu:show'),
  openSettings: () => ipcRenderer.send('settings:open'),
  sendAct: (a) => ipcRenderer.send('act:send', a),
  getAgent: () => ipcRenderer.invoke('agent:get'),
  askAnswer: (p) => ipcRenderer.invoke('ask:answer', p),
  getAsks: () => ipcRenderer.invoke('ask:get'),
  getMedia: () => ipcRenderer.invoke('media:get'),
  reportBeat: (b) => ipcRenderer.send('media:beat', b),
  openPanel: (tab) => ipcRenderer.send('panel:open', tab),
  emit: (kind, a, b) => ipcRenderer.send('pet:emit', kind, a, b),
  setDock: (d) => ipcRenderer.send('dock:set', d),
  addAffection: (n) => ipcRenderer.send('affection:add', n),
  reminders: {
    list: () => ipcRenderer.invoke('reminders:list'),
    add: (r) => ipcRenderer.invoke('reminders:add', r),
    remove: (id) => ipcRenderer.invoke('reminders:remove', id)
  },
  on: (ch, cb) => ipcRenderer.on(ch, (_e, ...a) => cb(...a))
});
