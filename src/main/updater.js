'use strict'

// Checks GitHub Releases for a newer version. Nothing is downloaded or
// installed without the user agreeing first. Only the installed (NSIS) build
// can update itself; dev runs and the portable exe skip this entirely.

const { app, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')

const STARTUP_DELAY_MS = 5000

let getWindow = () => null
let busy = false

const canUpdate = () => app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR

function showMessage(options) {
  const win = getWindow()
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

async function checkForUpdates({ interactive = false } = {}) {
  if (!canUpdate()) {
    if (interactive) {
      await showMessage({
        type: 'info',
        title: 'Updates',
        message: 'Automatic updates are only available in the installed version of Gastropub.',
        detail: 'Download the latest release from github.com/joshfeld/gastropub/releases.',
      })
    }
    return
  }
  if (busy) return
  busy = true
  try {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    if (!result?.isUpdateAvailable || !version) {
      if (interactive) {
        await showMessage({
          type: 'info',
          title: 'Updates',
          message: "You're up to date.",
          detail: `Gastropub ${app.getVersion()} is the latest version.`,
        })
      }
      return
    }

    const { response: download } = await showMessage({
      type: 'info',
      title: 'Update available',
      message: `Gastropub ${version} is available.`,
      detail: `You have version ${app.getVersion()}. Download the update now?`,
      buttons: ['Download', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    })
    if (download !== 0) return

    await autoUpdater.downloadUpdate()
    const { response: restart } = await showMessage({
      type: 'info',
      title: 'Update ready',
      message: `Gastropub ${version} has been downloaded.`,
      detail: 'Restart now to install it, or it will be installed the next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (restart === 0) setImmediate(() => autoUpdater.quitAndInstall(false, true))
  } catch (error) {
    // Being offline should never get in the way of reading; only report
    // failures when the user asked for the check.
    console.error('Update check failed:', error)
    if (interactive) {
      await showMessage({
        type: 'error',
        title: 'Updates',
        message: 'Could not check for updates.',
        detail: error?.message ?? String(error),
      })
    }
  } finally {
    busy = false
  }
}

function initUpdater(windowGetter) {
  getWindow = windowGetter
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = null
  if (canUpdate()) setTimeout(() => checkForUpdates(), STARTUP_DELAY_MS)
}

module.exports = { initUpdater, checkForUpdates }
