import './vendor/foliate-js/view.js'

const THEME_COLORS = {
  light: { fg: '#1f1d1a', link: '#a2552b' },
  sepia: { fg: '#4a3b28', link: '#9a5b25' },
  dark: { fg: '#e6e3dd', link: '#e08a55' },
}

const bookCSS = ({ theme, fontSize }) => {
  const { fg, link } = THEME_COLORS[theme] ?? THEME_COLORS.light
  // The page background stays transparent so the themed viewer shows through;
  // the paginator caches the first background it sees.
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${theme === 'dark' ? 'dark' : 'light'};
      color: ${fg};
      background: transparent !important;
      font-size: ${fontSize}% !important;
    }
    body {
      color: ${fg};
      background: transparent !important;
    }
    ${theme === 'dark' ? `body *:not(a) { color: inherit !important; background-color: transparent !important; }` : ''}
    a:link, a:visited { color: ${link}; }
    p, li, blockquote, dd {
      line-height: 1.5;
      hyphens: auto;
      widows: 2;
      orphans: 2;
    }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; }
    aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"] {
      display: none;
    }
  `
}

const metadataText = value => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join(', ')
  if (typeof value === 'object') return metadataText(value.name ?? Object.values(value)[0])
  return ''
}

const toTocItems = items => (items ?? []).map(item => ({
  label: (item.label ?? '').trim() || 'Untitled',
  target: item.href,
  children: toTocItems(item.subitems),
}))

// Mouse wheels send one large delta per notch, touchpads a stream of small
// ones. A page turns once enough scroll has built up, and the rest of a fast
// spin or touchpad fling is ignored for a moment so it doesn't skip pages.
const WHEEL_THRESHOLD = 40
const WHEEL_IDLE_MS = 150
const WHEEL_COOLDOWN_MS = 350
const WHEEL_DELTA_MODE_SCALE = [1, 40, 800] // pixels, lines, pages

export class EpubViewer {
  kind = 'epub'
  #wheelDelta = 0
  #lastWheel = 0
  #lastTurn = 0

  constructor(container, { onRelocate, onKeydown }) {
    this.container = container
    this.onRelocate = onRelocate
    this.onKeydown = onKeydown
    this.view = document.createElement('foliate-view')
    this.container.append(this.view)
    // Wheel events over the page margins; those over the text come from the
    // book's iframe and are hooked up in the load listener below.
    this.view.addEventListener('wheel', this.#onWheel, { passive: false })
  }

  #onWheel = event => {
    if (event.ctrlKey) return // pinch-to-zoom and Ctrl+wheel
    event.preventDefault()
    const now = performance.now()
    const newGesture = now - this.#lastWheel > WHEEL_IDLE_MS
    this.#lastWheel = now
    if (newGesture) this.#wheelDelta = 0
    else if (now - this.#lastTurn < WHEEL_COOLDOWN_MS) return

    const scale = WHEEL_DELTA_MODE_SCALE[event.deltaMode] ?? 1
    const { deltaX, deltaY } = event
    this.#wheelDelta += (Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX) * scale
    if (Math.abs(this.#wheelDelta) < WHEEL_THRESHOLD) return

    const forward = this.#wheelDelta > 0
    this.#wheelDelta = 0
    this.#lastTurn = now
    if (forward) this.view.next()
    else this.view.prev()
  }

  async open(data, name, location, style) {
    await this.view.open(new File([data], name))
    const { book } = this.view
    this.title = metadataText(book.metadata?.title) || name
    this.toc = toTocItems(book.toc)

    // Key and wheel events inside a book page never reach the main document.
    this.view.addEventListener('load', ({ detail: { doc } }) => {
      doc.addEventListener('keydown', this.onKeydown)
      doc.addEventListener('wheel', this.#onWheel, { passive: false })
    })
    this.view.addEventListener('relocate', ({ detail }) => {
      const percent = Math.round((detail.fraction ?? 0) * 100)
      const chapter = detail.tocItem?.label?.trim()
      this.onRelocate({
        location: detail.cfi,
        label: chapter ? `${chapter} · ${percent}%` : `${percent}%`,
        tocTarget: detail.tocItem?.href ?? null,
      })
    })

    const { renderer } = this.view
    renderer.setAttribute('flow', 'paginated')
    renderer.setAttribute('margin', '48px')
    renderer.setAttribute('gap', '6%')
    renderer.setAttribute('max-inline-size', '720px')
    renderer.setAttribute('max-column-count', '2')
    this.setStyle(style)
    await this.view.init({ lastLocation: location ?? null, showTextStart: true })
  }

  setStyle(style) {
    this.view.renderer?.setStyles?.(bookCSS(style))
  }

  next() {
    return this.view.goRight()
  }

  prev() {
    return this.view.goLeft()
  }

  goTo(target) {
    return this.view.goTo(target)
  }

  destroy() {
    this.view.close()
    this.view.remove()
  }
}
