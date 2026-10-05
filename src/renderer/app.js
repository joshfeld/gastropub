const api = window.gastropub
const $ = selector => document.querySelector(selector)

const FONT_STEP = 10
const FONT_MIN = 70
const FONT_MAX = 200

const state = {
  settings: { theme: 'light', fontSize: 100 },
  viewer: null,
  bookId: null,
  openToken: 0,
}

// UI helpers

let toastTimer
function showError(message) {
  const toast = $('#toast')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 6000)
}

const debounce = (fn, ms) => {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

const saveProgress = debounce((id, location) => {
  api.saveProgress(id, location).catch(error => console.error(error))
}, 400)

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  $('#theme-select').value = theme
}

function updateZoomLabel() {
  const { viewer } = state
  $('#zoom-label').textContent = viewer?.kind === 'pdf'
    ? `${viewer.zoomPercent}%`
    : `${state.settings.fontSize}%`
}

async function updateSettings(changes) {
  state.settings = { ...state.settings, ...changes }
  applyTheme(state.settings.theme)
  state.viewer?.setStyle(state.settings)
  updateZoomLabel()
  state.settings = await api.updateSettings(state.settings)
}

// Recent books

function renderRecent(recent) {
  for (const list of [$('#recent-menu'), $('#welcome-recent-list')]) {
    list.replaceChildren()
    for (const book of recent) {
      const li = document.createElement('li')
      const open = document.createElement('button')
      open.className = 'recent-open'
      open.title = book.name
      const name = document.createElement('span')
      name.className = 'recent-name'
      name.textContent = book.name
      const kind = document.createElement('span')
      kind.className = 'recent-kind'
      kind.textContent = book.kind
      open.append(name, kind)
      open.addEventListener('click', () => {
        closeRecentPopover()
        api.openRecent(book.id)
      })
      const remove = document.createElement('button')
      remove.className = 'recent-remove'
      remove.title = 'Remove from list'
      remove.setAttribute('aria-label', `Remove ${book.name} from recent books`)
      remove.textContent = '×'
      remove.addEventListener('click', async () => renderRecent(await api.removeRecent(book.id)))
      li.append(open, remove)
      list.append(li)
    }
  }
  if (!recent.length) {
    const empty = document.createElement('li')
    empty.className = 'recent-empty'
    empty.textContent = 'No recent books'
    $('#recent-menu').append(empty)
  }
  $('#welcome-recent').hidden = recent.length === 0
}

function closeRecentPopover() {
  $('#recent-popover').hidden = true
  $('#recent-button').setAttribute('aria-expanded', 'false')
}

// Table of contents

let tocButtons = new Map()

function renderToc(items) {
  const toc = $('#toc')
  tocButtons = new Map()
  if (!items?.length) {
    const empty = document.createElement('p')
    empty.className = 'toc-empty'
    empty.textContent = 'This book has no table of contents.'
    toc.replaceChildren(empty)
    return
  }
  const build = list => {
    const ul = document.createElement('ul')
    for (const item of list) {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.textContent = item.label
      button.title = item.label
      button.disabled = item.target == null
      button.addEventListener('click', () => state.viewer?.goTo(item.target))
      if (typeof item.target === 'string') tocButtons.set(item.target, button)
      li.append(button)
      if (item.children.length) li.append(build(item.children))
      ul.append(li)
    }
    return ul
  }
  toc.replaceChildren(build(items))
}

function highlightToc(target) {
  for (const button of tocButtons.values()) button.classList.remove('current')
  tocButtons.get(target)?.classList.add('current')
}

function toggleSidebar(force) {
  if (!state.viewer) return
  const sidebar = $('#sidebar')
  sidebar.hidden = force === undefined ? !sidebar.hidden : !force
}

// Opening and closing books

function closeBook() {
  state.viewer?.destroy()
  state.viewer = null
  state.bookId = null
  document.title = 'Gastropub'
  $('#book-title').textContent = ''
  $('#reading-controls').hidden = true
  $('#sidebar').hidden = true
  $('#sidebar-button').disabled = true
  $('#toc').replaceChildren()
  $('#welcome').hidden = false
}

async function openBook({ id, name, kind, data, location }) {
  const token = ++state.openToken
  closeBook()
  $('#welcome').hidden = true
  $('#loading').hidden = false

  const onRelocate = detail => {
    if (token !== state.openToken) return
    if (detail.page) {
      $('#page-input').value = String(detail.page)
    } else {
      $('#epub-location').textContent = detail.label
      $('#epub-location').title = detail.label
    }
    if (detail.tocTarget) highlightToc(detail.tocTarget)
    saveProgress(id, detail.location)
  }

  try {
    const module = kind === 'pdf' ? await import('./pdf-viewer.js') : await import('./epub-viewer.js')
    const Viewer = kind === 'pdf' ? module.PdfViewer : module.EpubViewer
    const viewer = new Viewer($('#viewer'), { onRelocate, onKeydown: handleKeydown })
    state.viewer = viewer
    state.bookId = id
    await viewer.open(data, name, location, state.settings)
    if (token !== state.openToken) return

    document.title = `${viewer.title} — Gastropub`
    $('#book-title').textContent = viewer.title
    $('#book-title').title = viewer.title
    $('#epub-location').hidden = kind === 'pdf'
    $('#pdf-location').hidden = kind !== 'pdf'
    if (kind === 'pdf') {
      $('#page-count').textContent = String(viewer.pageCount)
      $('#page-input').max = String(viewer.pageCount)
    }
    $('#reading-controls').hidden = false
    $('#sidebar-button').disabled = false
    renderToc(viewer.toc)
    updateZoomLabel()
  } catch (error) {
    if (token !== state.openToken) return
    console.error(error)
    closeBook()
    showError(`Could not open ${name}: ${error?.message ?? error}`)
  } finally {
    if (token === state.openToken) $('#loading').hidden = true
  }
}

// Commands

function zoom(direction) {
  const { viewer } = state
  if (!viewer) return
  if (viewer.kind === 'pdf') {
    if (direction > 0) viewer.zoomIn()
    else if (direction < 0) viewer.zoomOut()
    else viewer.zoomReset()
    updateZoomLabel()
    return
  }
  const fontSize = direction === 0
    ? 100
    : Math.min(FONT_MAX, Math.max(FONT_MIN, state.settings.fontSize + direction * FONT_STEP))
  updateSettings({ fontSize })
}

function runCommand(name) {
  switch (name) {
    case 'close-book': return closeBook()
    case 'toggle-sidebar': return toggleSidebar()
    case 'zoom-in': return zoom(1)
    case 'zoom-out': return zoom(-1)
    case 'zoom-reset': return zoom(0)
  }
}

function handleKeydown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
  const target = event.target
  if (target instanceof HTMLElement && target.matches('input, select, textarea')) return
  if (event.key === 'Escape') {
    closeRecentPopover()
    return
  }
  const { viewer } = state
  if (!viewer) return
  const isPdf = viewer.kind === 'pdf'
  switch (event.key) {
    case 'ArrowLeft':
    case 'PageUp':
      if (isPdf && event.key === 'PageUp') return
      event.preventDefault()
      viewer.prev()
      break
    case 'ArrowRight':
    case 'PageDown':
      if (isPdf && event.key === 'PageDown') return
      event.preventDefault()
      viewer.next()
      break
    case ' ':
      if (isPdf) return
      event.preventDefault()
      if (event.shiftKey) viewer.prev()
      else viewer.next()
      break
  }
}

// Wiring

function wireUi() {
  $('#open-button').addEventListener('click', () => api.openDialog())
  $('#welcome-open-button').addEventListener('click', () => api.openDialog())
  $('#sidebar-button').addEventListener('click', () => toggleSidebar())
  $('#prev-button').addEventListener('click', () => state.viewer?.prev())
  $('#next-button').addEventListener('click', () => state.viewer?.next())
  $('#zoom-in-button').addEventListener('click', () => zoom(1))
  $('#zoom-out-button').addEventListener('click', () => zoom(-1))
  $('#zoom-label').addEventListener('click', () => zoom(0))
  $('#theme-select').addEventListener('change', event => updateSettings({ theme: event.target.value }))

  $('#page-input').addEventListener('change', event => {
    const page = Number.parseInt(event.target.value, 10)
    if (Number.isInteger(page) && state.viewer?.kind === 'pdf') state.viewer.goToPage(page)
  })

  $('#recent-button').addEventListener('click', event => {
    event.stopPropagation()
    const popover = $('#recent-popover')
    popover.hidden = !popover.hidden
    $('#recent-button').setAttribute('aria-expanded', String(!popover.hidden))
  })
  document.addEventListener('click', event => {
    if (!$('#recent-popover').contains(event.target)) closeRecentPopover()
  })
  document.addEventListener('keydown', handleKeydown)

  // Drag and drop a book anywhere on the window.
  let dragDepth = 0
  document.addEventListener('dragenter', event => {
    event.preventDefault()
    if (++dragDepth === 1) document.body.classList.add('dragging')
  })
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0
      document.body.classList.remove('dragging')
    }
  })
  document.addEventListener('dragover', event => event.preventDefault())
  document.addEventListener('drop', event => {
    event.preventDefault()
    dragDepth = 0
    document.body.classList.remove('dragging')
    const file = event.dataTransfer?.files?.[0]
    if (file) api.openDropped(file)
  })

  api.onBookOpened(openBook)
  api.onBookError(showError)
  api.onRecentChanged(renderRecent)
  api.onMenuCommand(runCommand)
}

async function start() {
  wireUi()
  const { settings, recent } = await api.ready()
  state.settings = settings
  applyTheme(settings.theme)
  updateZoomLabel()
  renderRecent(recent)
}

start().catch(error => {
  console.error(error)
  showError(`Gastropub failed to start: ${error?.message ?? error}`)
})
