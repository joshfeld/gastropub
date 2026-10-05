# Gastropub

A delicious EPUB and PDF reader for Windows.

Gastropub is a small, local-only desktop reader built with Electron. It opens EPUB and PDF files (plus MOBI, AZW3, FB2 and CBZ), remembers where you left off, and stays out of your way.

## Features

- **EPUB** rendering with [foliate-js](https://github.com/johnfactotum/foliate-js): paginated two-column layout, table of contents, adjustable text size, chapter and progress indicator
- **PDF** rendering with [pdf.js](https://mozilla.github.io/pdf.js/): continuous scroll, fit-to-width and zoom, page jump, document outline, selectable text
- Light, sepia, and dark themes
- Reading position saved per book, plus a recent-books list
- Open files from the toolbar, by drag-and-drop, or with **Open with → Gastropub** in Explorer

## Keyboard and mouse

| Action | Keys |
| --- | --- |
| Open a book | `Ctrl+O` |
| Close the book | `Ctrl+W` |
| Next / previous page | `→` / `←` (EPUB also `Space` / `Shift+Space`, `PageDown` / `PageUp`, and mouse wheel down / up) |
| Toggle contents | `Ctrl+B` |
| Larger / smaller / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Full screen | `F11` |

## Development

Requires Node.js 22.13 or newer; Node.js 24 is recommended.

```bash
npm install     # also copies the reader libraries into src/renderer/vendor
npm start       # run the app
npm test        # unit tests
npm run audit   # check dependencies for known vulnerabilities
```

## Building the Windows app

```bash
npm run dist
```

This writes two files to `dist/`:

- `Gastropub Setup <version>.exe`: an installer (per-user, no admin rights needed) that adds Start menu and desktop shortcuts and registers Gastropub for `.epub` and `.pdf` files
- `Gastropub-<version>-portable.exe`: a single executable that runs without installing

The builds are not code-signed, so Windows SmartScreen will warn the first time you run them. Choose **More info → Run anyway**.

To regenerate the app icon, run `node scripts/make-icon.mjs`.

## Updates

The installed app checks [GitHub Releases](https://github.com/joshfeld/gastropub/releases) a few seconds after it starts, and on demand from **Help → Check for Updates**. It always asks before downloading and again before restarting to install. Being offline is silently ignored. The portable exe doesn't update itself.

To ship a release:

1. Bump `version` in `package.json` (for example to `0.2.0`) and commit.
2. Tag and push: `git tag v0.2.0 && git push origin main --tags`
3. The **Release** workflow tests the code, builds the installer, and uploads it to a **draft** release.
4. Review the draft on GitHub and click **Publish release**. Installed copies only see an update once it is published.

Installers are downloaded over HTTPS and checked against the SHA-512 hash in the release's `latest.yml`. Because builds are not code-signed, the updater cannot verify the publisher, so protect the GitHub account (two-factor authentication) that can publish releases.

## Security

E-books are untrusted input, so the app is locked down:

- The UI runs in a sandboxed renderer with context isolation and no Node.js access. A small preload bridge exposes only the handful of calls the reader needs.
- A strict Content Security Policy is applied to every page, including the frames that display book content, so scripts embedded in EPUBs never run and books cannot load remote resources (no tracking pixels).
- The page never chooses which files to read. Books come from the system file dialog, the command line, a dropped file (resolved by the preload, not the page), or a recent-books ID, and every file is checked for type and size before it is read.
- Navigation and new windows are blocked; external links open in your default browser. All permission requests (camera, notifications, etc.) are denied.
- JavaScript embedded in PDFs is never executed, and pdf.js runs with `eval` disabled.
- Packaged builds set Electron fuses that disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and the Node inspector, and enable ASAR integrity checks.
- `.gitignore` keeps dependencies, build output, secrets, signing certificates, and book files out of the repository. Dependabot keeps dependencies current.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE). pdf.js is Apache-2.0 and foliate-js is MIT.
