'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Each subscription returns an unsubscribe function. The raw IPC event is
// never handed to the page.
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('gastropub', {
  ready: () => ipcRenderer.invoke('app:ready'),
  openDialog: () => ipcRenderer.invoke('book:openDialog'),
  openRecent: id => ipcRenderer.invoke('book:openRecent', String(id)),
  openDropped: file => {
    if (!(file instanceof File)) return Promise.resolve(false)
    const filePath = webUtils.getPathForFile(file)
    return filePath ? ipcRenderer.invoke('book:openDropped', filePath) : Promise.resolve(false)
  },
  removeRecent: id => ipcRenderer.invoke('recent:remove', String(id)),
  saveProgress: (id, location) => ipcRenderer.invoke('progress:set', String(id), location),
  updateSettings: changes => ipcRenderer.invoke('settings:update', {
    theme: changes?.theme,
    fontSize: changes?.fontSize,
  }),
  onBookOpened: callback => subscribe('book:opened', callback),
  onBookError: callback => subscribe('book:error', callback),
  onRecentChanged: callback => subscribe('recent:changed', callback),
  onMenuCommand: callback => subscribe('menu:command', callback),
})
