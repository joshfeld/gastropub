import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs'

const vendorUrl = path => new URL(`vendor/pdfjs/${path}`, document.baseURI).href

pdfjsLib.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.mjs')

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const ZOOM_STEP = 1.2
const PAGE_GAP = 16
const SIDE_PADDING = 48
const MAX_CANVAS_PIXELS = 16_000_000

const debounce = (fn, ms) => {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export class PdfViewer {
  kind = 'pdf'
  pages = []
  scale = 1
  fitWidth = true
  currentPage = 1

  constructor(container, { onRelocate }) {
    this.onRelocate = onRelocate
    this.scroller = document.createElement('div')
    this.scroller.className = 'pdf-scroller'
    this.scroller.tabIndex = 0
    container.append(this.scroller)

    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = this.pages[Number(entry.target.dataset.index)]
        if (entry.isIntersecting) this.#render(page)
        else this.#unrender(page)
      }
    }, { root: this.scroller, rootMargin: '150% 0px' })

    this.resizeObserver = new ResizeObserver(debounce(() => {
      if (this.fitWidth && this.pages.length) this.#layout()
    }, 150))

    let frame = 0
    this.scroller.addEventListener('scroll', () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        this.#updateCurrentPage()
      })
    })
  }

  async open(data, name, location) {
    this.loadingTask = pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      enableXfa: false,
      cMapUrl: vendorUrl('cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: vendorUrl('standard_fonts/'),
      wasmUrl: vendorUrl('wasm/'),
      iccUrl: vendorUrl('iccs/'),
    })
    this.pdf = await this.loadingTask.promise

    const metadata = await this.pdf.getMetadata().catch(() => null)
    this.title = metadata?.info?.Title?.trim() || name

    for (let number = 1; number <= this.pdf.numPages; number++) {
      const page = await this.pdf.getPage(number)
      const el = document.createElement('div')
      el.className = 'pdf-page'
      el.dataset.index = String(number - 1)
      this.scroller.append(el)
      this.pages.push({ number, page, el, base: page.getViewport({ scale: 1 }), renderedScale: null, task: null })
    }

    this.toc = await this.#outline()
    this.#layout()
    for (const p of this.pages) this.observer.observe(p.el)
    this.resizeObserver.observe(this.scroller)

    const startPage = Number.isInteger(location) ? location : 1
    this.goToPage(startPage)
    this.#updateCurrentPage(true)
    this.scroller.focus()
  }

  get pageCount() {
    return this.pages.length
  }

  get zoomPercent() {
    return Math.round(this.scale * 100)
  }

  setStyle() {
    // Themes are applied with a CSS filter on the page elements.
  }

  next() {
    this.goToPage(this.currentPage + 1)
  }

  prev() {
    this.goToPage(this.currentPage - 1)
  }

  goToPage(number) {
    const page = this.pages[Math.min(Math.max(number, 1), this.pages.length) - 1]
    if (!page) return
    this.scroller.scrollTop = page.el.offsetTop - PAGE_GAP
    this.#updateCurrentPage()
  }

  async goTo(target) {
    if (typeof target === 'number') return this.goToPage(target)
    try {
      const dest = typeof target === 'string' ? await this.pdf.getDestination(target) : target
      if (!Array.isArray(dest)) return
      const [ref] = dest
      const index = typeof ref === 'number' ? ref : await this.pdf.getPageIndex(ref)
      this.goToPage(index + 1)
    } catch (error) {
      console.error('Could not resolve PDF destination', error)
    }
  }

  zoomIn() {
    this.#setScale(this.scale * ZOOM_STEP)
  }

  zoomOut() {
    this.#setScale(this.scale / ZOOM_STEP)
  }

  zoomReset() {
    this.fitWidth = true
    this.#layout()
  }

  destroy() {
    this.observer.disconnect()
    this.resizeObserver.disconnect()
    for (const p of this.pages) p.task?.cancel()
    this.pages = []
    this.loadingTask?.destroy()
    this.scroller.remove()
  }

  #setScale(scale) {
    this.fitWidth = false
    this.#layout(Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE))
  }

  // Sizes every page placeholder for the current scale, keeping the reader's
  // place, and lets the observer re-render whatever is on screen.
  #layout(scale) {
    if (this.fitWidth) {
      const widest = Math.max(...this.pages.map(p => p.base.width))
      scale = (this.scroller.clientWidth - SIDE_PADDING) / widest
    }
    scale = Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)

    const anchor = this.pages[this.currentPage - 1]
    const offset = anchor ? (this.scroller.scrollTop - anchor.el.offsetTop) / anchor.el.offsetHeight : 0

    this.scale = scale
    for (const p of this.pages) {
      p.el.style.width = `${Math.floor(p.base.width * scale)}px`
      p.el.style.height = `${Math.floor(p.base.height * scale)}px`
      p.el.style.setProperty('--scale-factor', String(scale))
      if (p.renderedScale !== null && p.renderedScale !== scale) {
        p.renderedScale = null
        this.#render(p, true)
      }
    }

    if (anchor) this.scroller.scrollTop = anchor.el.offsetTop + offset * anchor.el.offsetHeight
    this.#updateCurrentPage(true)
  }

  #isNearViewport(p) {
    const margin = this.scroller.clientHeight * 1.5
    const top = p.el.offsetTop - this.scroller.scrollTop
    return top < this.scroller.clientHeight + margin && top + p.el.offsetHeight > -margin
  }

  async #render(p, rerender = false) {
    if (!p || p.renderedScale === this.scale) return
    if (rerender && !this.#isNearViewport(p)) return this.#unrender(p)
    p.task?.cancel()
    const scale = this.scale
    const viewport = p.page.getViewport({ scale })
    const ratio = Math.min(window.devicePixelRatio || 1,
      Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    const task = p.page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
    })
    p.task = task
    try {
      await task.promise
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') console.error(error)
      return
    }
    if (p.task !== task) return
    p.task = null

    const textLayer = document.createElement('div')
    textLayer.className = 'textLayer'
    p.el.replaceChildren(canvas, textLayer)
    p.renderedScale = scale
    try {
      await new pdfjsLib.TextLayer({
        textContentSource: p.page.streamTextContent(),
        container: textLayer,
        viewport,
      }).render()
    } catch (error) {
      console.warn('Text layer failed for page', p.number, error)
    }
  }

  #unrender(p) {
    if (!p) return
    p.task?.cancel()
    p.task = null
    p.renderedScale = null
    p.el.replaceChildren()
  }

  #updateCurrentPage(force = false) {
    const line = this.scroller.scrollTop + this.scroller.clientHeight * 0.3
    let low = 0
    let high = this.pages.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      const el = this.pages[mid].el
      if (el.offsetTop + el.offsetHeight + PAGE_GAP <= line) low = mid + 1
      else high = mid
    }
    const number = low + 1
    if (!force && number === this.currentPage) return
    this.currentPage = number
    this.onRelocate({ location: number, page: number, label: `Page ${number} of ${this.pages.length}` })
  }

  async #outline() {
    const outline = await this.pdf.getOutline().catch(() => null)
    const convert = items => (items ?? []).map(item => ({
      label: (item.title ?? '').trim() || 'Untitled',
      target: item.dest ?? null,
      children: convert(item.items),
    }))
    return convert(outline)
  }
}
