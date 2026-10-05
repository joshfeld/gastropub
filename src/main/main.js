'use strict'

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { BOOK_TYPES, Library, bookKind, validateBookFile } = require('./files')
const { checkForUpdates, initUpdater } = require('./updater')

const APP_SCHEME = 'app'
const APP_HOST = 'gastropub'
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
const RENDERER_DIR = path.join(__dirname, '..', 'renderer')

// Applied to every page we serve. Book content is rendered in blob: iframes,
// which inherit this policy, so scripts embedded in e-books can never run.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "media-src blob:",
  "connect-src 'self' blob: data:",
  "worker-src 'self'",
  "frame-src blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
}

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

app.enableSandbox()

let mainWindow = null
let library = null
let rendererReady = false
let pendingFile = findBookArg(process.argv)

function findBookArg(argv) {
  return argv.slice(1).find(arg => !arg.startsWith('-') && bookKind(arg)) ?? null
}

// Serves files from src/renderer only. Anything that resolves outside it is a 404.
async function handleAppProtocol(request) {
  const url = new URL(request.url)
  if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })
  let relative
  try {
    relative = decodeURIComponent(url.pathname)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (relative === '/') relative = '/index.html'
  const filePath = path.resolve(RENDERER_DIR, `.${relative}`)
  if (!filePath.startsWith(RENDERER_DIR + path.sep)) return new Response('Not found', { status: 404 })
  try {
    const body = await fs.promises.readFile(filePath)
    return new Response(body, {
      headers: {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function isTrustedSender(event) {
  const url = event.senderFrame?.url
  return typeof url === 'string' && url.startsWith(`${APP_ORIGIN}/`)
}

function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return listener(...args)
  })
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

async function openBook(filePath) {
  try {
    const file = await validateBookFile(filePath)
    const data = await fs.promises.readFile(file.path)
    const id = library.addRecent(file)
    sendToRenderer('book:opened', {
      id,
      name: file.name,
      kind: file.kind,
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      location: library.getProgress(id),
    })
    sendToRenderer('recent:changed', library.listRecent())
    return true
  } catch (error) {
    sendToRenderer('book:error', `Could not open ${path.basename(String(filePath))}: ${error.message}`)
    return false
  }
}

async function showOpenDialog() {
  const extensions = Object.keys(BOOK_TYPES).map(ext => ext.slice(1))
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open book',
    properties: ['openFile'],
    filters: [
      { name: 'Books', extensions },
      { name: 'EPUB', extensions: ['epub'] },
      { name: 'PDF', extensions: ['pdf'] },
    ],
  })
  if (!result.canceled && result.filePaths[0]) await openBook(result.filePaths[0])
}

function registerIpc() {
  handle('app:ready', () => {
    rendererReady = true
    if (pendingFile) {
      const file = pendingFile
      pendingFile = null
      setImmediate(() => openBook(file))
    }
    return { settings: library.getSettings(), recent: library.listRecent() }
  })
  handle('book:openDialog', () => showOpenDialog())
  handle('book:openRecent', async id => {
    const filePath = typeof id === 'string' ? library.recentPath(id) : null
    if (!filePath) return false
    const opened = await openBook(filePath)
    if (!opened) {
      library.removeRecent(id)
      sendToRenderer('recent:changed', library.listRecent())
    }
    return opened
  })
  // The path comes from webUtils.getPathForFile in the preload, and is held to
  // the same type and size checks as any other file.
  handle('book:openDropped', filePath => openBook(filePath))
  handle('recent:remove', id => {
    if (typeof id === 'string') library.removeRecent(id)
    return library.listRecent()
  })
  handle('progress:set', (id, location) => library.setProgress(id, location))
  handle('settings:update', changes => library.updateSettings(changes))
}

function buildMenu() {
  const command = name => () => sendToRenderer('menu:command', name)
  const template = [
    {
      label: '&File',
      submenu: [
        { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { label: '&Close Book', accelerator: 'CmdOrCtrl+W', click: command('close-book') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Toggle &Contents', accelerator: 'CmdOrCtrl+B', click: command('toggle-sidebar') },
        { type: 'separator' },
        { label: 'Zoom &In', accelerator: 'CmdOrCtrl+=', click: command('zoom-in') },
        { label: 'Zoom &Out', accelerator: 'CmdOrCtrl+-', click: command('zoom-out') },
        { label: '&Reset Zoom', accelerator: 'CmdOrCtrl+0', click: command('zoom-reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Check for &Updates…', click: () => checkForUpdates({ interactive: true }) },
        { type: 'separator' },
        { label: 'Gastropub on GitHub', click: () => shell.openExternal('https://github.com/joshfeld/gastropub') },
        {
          label: 'About Gastropub',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About Gastropub',
            message: `Gastropub ${app.getVersion()}`,
            detail: 'A delicious EPUB and PDF reader.',
          }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    show: false,
    backgroundColor: '#f7f5f0',
    title: 'Gastropub',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })
  mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
}

function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    // The UI never navigates; links inside books are handled in the renderer.
    contents.on('will-navigate', event => event.preventDefault())
    // Book iframes may only load the blob: documents the renderer created.
    contents.on('will-frame-navigate', event => {
      if (event.isMainFrame) return
      if (!event.url.startsWith(`blob:${APP_ORIGIN}/`) && event.url !== 'about:blank') event.preventDefault()
    })
    contents.on('will-attach-webview', event => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const { protocol: scheme } = new URL(url)
        if (scheme === 'https:' || scheme === 'http:') shell.openExternal(url)
      } catch {
        // ignore malformed URLs
      }
      return { action: 'deny' }
    })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const file = findBookArg(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    if (!file) return
    if (rendererReady) openBook(file)
    else pendingFile = file
  })

  hardenWebContents()

  app.whenReady().then(() => {
    library = new Library(app.getPath('userData'))
    protocol.handle(APP_SCHEME, handleAppProtocol)
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    registerIpc()
    buildMenu()
    createWindow()
    initUpdater(() => mainWindow)
  })

  app.on('window-all-closed', () => app.quit())
}
