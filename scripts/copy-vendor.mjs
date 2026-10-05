// Copies the browser builds of third-party libraries from node_modules into
// src/renderer/vendor so the renderer can load them from its own origin.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const vendor = join(root, 'src', 'renderer', 'vendor')

rmSync(vendor, { recursive: true, force: true })
mkdirSync(vendor, { recursive: true })

// foliate-js: ES modules loaded as-is. Skip its demo app, tests and build tooling.
const foliateSrc = join(modules, 'foliate-js')
const foliateDest = join(vendor, 'foliate-js')
const foliateSkip = new Set(['.github', 'tests', 'rollup', 'reader.html', 'reader.js',
    'rollup.config.js', 'eslint.config.js', 'opds.js', 'dict.js', 'tts.js'])
cpSync(foliateSrc, foliateDest, {
    recursive: true,
    filter: src => !foliateSkip.has(src.slice(foliateSrc.length + 1).split(/[\\/]/)[0]),
})
// fixed-layout.js imports a constructable-stylesheet polyfill by bare specifier,
// which a browser cannot resolve. Chromium supports the feature natively.
const fixedLayout = join(foliateDest, 'fixed-layout.js')
const fixedLayoutSource = readFileSync(fixedLayout, 'utf8')
const polyfillImport = "import 'construct-style-sheets-polyfill'"
if (!fixedLayoutSource.includes(polyfillImport))
    throw new Error('foliate-js fixed-layout.js changed; review copy-vendor.mjs')
writeFileSync(fixedLayout, fixedLayoutSource.replace(polyfillImport, '// polyfill not needed in Chromium'))

// pdf.js: library, worker, and the data files it fetches at runtime.
// The quickjs build is only used for running JavaScript embedded in PDFs, which we never enable.
const pdfjs = join(modules, 'pdfjs-dist')
const pdfjsDest = join(vendor, 'pdfjs')
mkdirSync(pdfjsDest, { recursive: true })
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs'])
    cpSync(join(pdfjs, 'build', file), join(pdfjsDest, file))
for (const dir of ['cmaps', 'standard_fonts', 'iccs'])
    cpSync(join(pdfjs, dir), join(pdfjsDest, dir), { recursive: true })
cpSync(join(pdfjs, 'wasm'), join(pdfjsDest, 'wasm'), {
    recursive: true,
    filter: src => !/quickjs/i.test(src),
})
cpSync(join(pdfjs, 'LICENSE'), join(pdfjsDest, 'LICENSE'))

console.log(`Vendor libraries copied to ${vendor}`)
