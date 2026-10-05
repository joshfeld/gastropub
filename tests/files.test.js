'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { afterEach, beforeEach, describe, it } = require('node:test')
const { BookFileError, Library, bookKey, bookKind, validateBookFile } = require('../src/main/files')

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gastropub-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (name, contents = 'x') => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, contents)
  return file
}

describe('bookKind', () => {
  it('recognises supported extensions case-insensitively', () => {
    assert.equal(bookKind('a.epub'), 'epub')
    assert.equal(bookKind('A.PDF'), 'pdf')
    assert.equal(bookKind('a.mobi'), 'epub')
  })

  it('rejects everything else', () => {
    assert.equal(bookKind('a.exe'), null)
    assert.equal(bookKind('a.pdf.exe'), null)
    assert.equal(bookKind('epub'), null)
  })
})

describe('validateBookFile', () => {
  it('accepts a regular book file', async () => {
    const file = write('book.epub', 'PK')
    const info = await validateBookFile(file)
    assert.deepEqual(info, { path: file, name: 'book.epub', kind: 'epub', size: 2 })
  })

  it('rejects unsupported types before touching the disk', async () => {
    await assert.rejects(validateBookFile(path.join(dir, 'missing.exe')), /Unsupported file type/)
  })

  it('rejects missing, empty, oversized and directory paths', async () => {
    await assert.rejects(validateBookFile(path.join(dir, 'missing.pdf')), /File not found/)
    await assert.rejects(validateBookFile(write('empty.pdf', '')), /File is empty/)
    await assert.rejects(validateBookFile(write('big.pdf', '12345'), 4), /File is too large/)
    fs.mkdirSync(path.join(dir, 'folder.epub'))
    await assert.rejects(validateBookFile(path.join(dir, 'folder.epub')), /Not a regular file/)
  })

  it('rejects non-string and NUL-containing paths', async () => {
    await assert.rejects(validateBookFile(42), BookFileError)
    await assert.rejects(validateBookFile('a\0.pdf'), BookFileError)
  })
})

describe('Library', () => {
  const book = (name, size = 10) => ({ path: path.join(dir, name), name, kind: 'pdf', size })

  it('keeps recent books newest first without duplicates and hides paths', () => {
    const library = new Library(dir)
    const a = library.addRecent(book('a.pdf'))
    library.addRecent(book('b.pdf'))
    library.addRecent(book('a.pdf'))
    const recent = library.listRecent()
    assert.deepEqual(recent.map(r => r.name), ['a.pdf', 'b.pdf'])
    assert.ok(recent.every(r => !('path' in r)))
    assert.equal(library.recentPath(a), path.join(dir, 'a.pdf'))
    assert.equal(library.recentPath('unknown'), null)
  })

  it('caps the recent list at ten', () => {
    const library = new Library(dir)
    for (let i = 0; i < 15; i++) library.addRecent(book(`${i}.pdf`))
    assert.equal(library.listRecent().length, 10)
  })

  it('persists progress across instances and validates input', () => {
    const id = bookKey(book('a.pdf'))
    const library = new Library(dir)
    assert.equal(library.setProgress(id, 'epubcfi(/6/4!/4/2)'), true)
    assert.equal(library.setProgress(id, { evil: true }), false)
    assert.equal(library.setProgress('../../etc', 3), false)
    assert.equal(library.setProgress(id, 'x'.repeat(5000)), false)
    assert.equal(new Library(dir).getProgress(id), 'epubcfi(/6/4!/4/2)')
  })

  it('only accepts known settings values', () => {
    const library = new Library(dir)
    assert.deepEqual(library.updateSettings({ theme: 'dark', fontSize: 120 }), { theme: 'dark', fontSize: 120 })
    assert.deepEqual(library.updateSettings({ theme: '<script>', fontSize: 9999 }), { theme: 'dark', fontSize: 120 })
  })

  it('recovers from a corrupt data file', () => {
    fs.writeFileSync(path.join(dir, 'library.json'), '{not json')
    const library = new Library(dir)
    assert.deepEqual(library.listRecent(), [])
    assert.deepEqual(library.getSettings(), { theme: 'light', fontSize: 100 })
  })
})
