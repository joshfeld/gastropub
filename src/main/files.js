'use strict'

// File validation and small JSON persistence helpers. Kept free of Electron
// imports so they can be unit tested with plain Node.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const BOOK_TYPES = {
  '.epub': 'epub',
  '.pdf': 'pdf',
  '.mobi': 'epub',
  '.azw3': 'epub',
  '.azw': 'epub',
  '.fb2': 'epub',
  '.fbz': 'epub',
  '.cbz': 'epub',
}
const MAX_FILE_SIZE = 500 * 1024 * 1024
const MAX_RECENT = 10
const MAX_PROGRESS_ENTRIES = 500
const MAX_LOCATION_LENGTH = 4096
const THEMES = ['light', 'sepia', 'dark']
const FONT_SIZE_RANGE = [70, 200]

class BookFileError extends Error {}

function bookKind(filePath) {
  return BOOK_TYPES[path.extname(filePath).toLowerCase()] ?? null
}

// Validates a path chosen by the user (dialog, command line, drag-and-drop)
// before any bytes are read.
async function validateBookFile(filePath, maxSize = MAX_FILE_SIZE) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0'))
    throw new BookFileError('Invalid file path')
  const resolved = path.resolve(filePath)
  const kind = bookKind(resolved)
  if (!kind) throw new BookFileError(`Unsupported file type: ${path.extname(resolved) || '(none)'}`)
  let stat
  try {
    stat = await fs.promises.stat(resolved)
  } catch {
    throw new BookFileError('File not found')
  }
  if (!stat.isFile()) throw new BookFileError('Not a regular file')
  if (stat.size === 0) throw new BookFileError('File is empty')
  if (stat.size > maxSize) throw new BookFileError('File is too large')
  return { path: resolved, name: path.basename(resolved), kind, size: stat.size }
}

function bookKey({ path: filePath, size }) {
  return crypto.createHash('sha256').update(`${filePath.toLowerCase()}|${size}`).digest('hex')
}

// A JSON file in the app's data folder. Corrupt or missing files fall back to
// the default; writes go through a temp file so a crash cannot truncate data.
class JsonStore {
  constructor(filePath, defaults) {
    this.filePath = filePath
    this.defaults = defaults
    this.data = null
  }

  get() {
    if (this.data) return this.data
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...structuredClone(this.defaults), ...parsed }
        : structuredClone(this.defaults)
    } catch {
      this.data = structuredClone(this.defaults)
    }
    return this.data
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }
}

class Library {
  constructor(dataDir) {
    this.store = new JsonStore(path.join(dataDir, 'library.json'), {
      recent: [],
      progress: {},
      settings: { theme: 'light', fontSize: 100 },
    })
  }

  addRecent(file) {
    const data = this.store.get()
    const id = bookKey(file)
    const entry = { id, path: file.path, name: file.name, kind: file.kind, openedAt: Date.now() }
    data.recent = [entry, ...data.recent.filter(r => r.id !== id)].slice(0, MAX_RECENT)
    this.store.save()
    return id
  }

  // The renderer only ever sees ids, never paths it could tamper with.
  recentPath(id) {
    return this.store.get().recent.find(r => r.id === id)?.path ?? null
  }

  listRecent() {
    return this.store.get().recent.map(({ id, name, kind, openedAt }) => ({ id, name, kind, openedAt }))
  }

  removeRecent(id) {
    const data = this.store.get()
    data.recent = data.recent.filter(r => r.id !== id)
    this.store.save()
  }

  getProgress(id) {
    return this.store.get().progress[id]?.location ?? null
  }

  setProgress(id, location) {
    if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) return false
    const valid = (typeof location === 'string' && location.length <= MAX_LOCATION_LENGTH)
      || (Number.isInteger(location) && location >= 0)
    if (!valid) return false
    const data = this.store.get()
    data.progress[id] = { location, updatedAt: Date.now() }
    const ids = Object.keys(data.progress)
    if (ids.length > MAX_PROGRESS_ENTRIES) {
      ids.sort((a, b) => data.progress[a].updatedAt - data.progress[b].updatedAt)
      for (const old of ids.slice(0, ids.length - MAX_PROGRESS_ENTRIES)) delete data.progress[old]
    }
    this.store.save()
    return true
  }

  getSettings() {
    return { ...this.store.get().settings }
  }

  updateSettings(changes) {
    if (!changes || typeof changes !== 'object') return this.getSettings()
    const settings = this.store.get().settings
    if (THEMES.includes(changes.theme)) settings.theme = changes.theme
    const size = changes.fontSize
    if (Number.isInteger(size) && size >= FONT_SIZE_RANGE[0] && size <= FONT_SIZE_RANGE[1])
      settings.fontSize = size
    this.store.save()
    return this.getSettings()
  }
}

module.exports = {
  BOOK_TYPES,
  MAX_FILE_SIZE,
  BookFileError,
  bookKind,
  bookKey,
  validateBookFile,
  JsonStore,
  Library,
}
