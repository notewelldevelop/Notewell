/* ═══════════════ NoteWell — Electron shell ═══════════════
   Wraps the app as a real, installable desktop program (.dmg / .exe / .AppImage)
   that runs completely offline.

   It boots the bundled NoteWell server on a free local port and points the
   window at it, rather than at file://, because service workers — and therefore
   proper offline caching — only run over http(s). */
'use strict';
const { app, BrowserWindow, Menu, shell, dialog, nativeTheme, ipcMain } = require('electron');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
let win = null;
let PORT = 8787;

function freePort() {
  return new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', () => res(8787));
  });
}

async function startServer() {
  PORT = await freePort();
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  process.env.NOTEWELL_DATA = path.join(app.getPath('userData'), 'data');
  require(path.join(ROOT, 'server', 'server.js'));
  // give the listener a beat
  await new Promise(r => setTimeout(r, 250));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 620,
    title: 'NoteWell',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161a' : '#eef0f4',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(ROOT, 'icons', process.platform === 'win32' ? 'icon-512.png' : 'icon-1024.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  });

  win.loadURL('http://127.0.0.1:' + PORT + '/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1:' + PORT)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.on('closed', () => { win = null; });
}

function menu() {
  const send = (fn) => () => win && win.webContents.executeJavaScript(fn).catch(() => {});
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New notebook', accelerator: 'CmdOrCtrl+N', click: send('NW.UI.showLibrary(); NW.UI.newNotebookDialog()') },
        { label: 'New folder', accelerator: 'CmdOrCtrl+Shift+N', click: send('NW.UI.showLibrary(); document.getElementById("btnNewFolder").click()') },
        { type: 'separator' },
        { label: 'Import PDF…', accelerator: 'CmdOrCtrl+O', click: send('NW.UI.showLibrary(); document.getElementById("btnImportPdf").click()') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+S', click: send('NW.UI.view==="editor" ? NW.UI.exportDialog() : document.getElementById("btnExportFolder").click()') },
        { label: 'Backup & restore…', click: send('NW.UI.backupDialog()') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('NW.Engine.History.stepBack()') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('NW.Engine.History.stepFwd()') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Select all on page', accelerator: 'CmdOrCtrl+A', click: send('NW.Tools.selectAll()') }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Pen', accelerator: '1', click: send('NW.Tools.setTool("pen")') },
        { label: 'Highlighter', accelerator: '2', click: send('NW.Tools.setTool("highlighter")') },
        { label: 'Eraser', accelerator: '3', click: send('NW.Tools.setTool("eraser")') },
        { label: 'Lasso', accelerator: '4', click: send('NW.Tools.setTool("lasso")') },
        { label: 'Shapes', accelerator: '5', click: send('NW.Tools.setTool("shape")') },
        { label: 'Paint bucket', accelerator: '6', click: send('NW.Tools.setTool("fill")') },
        { label: 'Text', accelerator: '7', click: send('NW.Tools.setTool("text")') },
        { type: 'separator' },
        { label: 'Switch pen ⇄ eraser', accelerator: 'E', click: send('NW.Tools.pencilToggle("menu")') },
        { label: 'Add page', click: send('NW.UI.pageStyleDialog(null,true)') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: send('NW.Engine.setZoom(NW.Engine.cam.zoom*1.25)') },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: send('NW.Engine.setZoom(NW.Engine.cam.zoom/1.25)') },
        { label: 'Fit width', accelerator: 'CmdOrCtrl+0', click: send('NW.Engine.fitWidth(); NW.emit("cam")') },
        { type: 'separator' },
        { label: 'Ask Claude', accelerator: 'CmdOrCtrl+K', click: send('NW.UI.toggleAI()') },
        { label: 'Page thumbnails', click: send('document.getElementById("btnPages").click()') },
        { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About NoteWell', click: () => dialog.showMessageBox(win, {
            type: 'info', title: 'NoteWell',
            message: 'NoteWell ' + app.getVersion(),
            detail: 'Handwritten notes, PDFs and Claude — for university students.\n\nEverything is stored on this computer. Nothing leaves it unless you sign in to sync or ask Claude a question.'
          })
        },
        { label: 'Where are my notes stored?', click: () => shell.openPath(path.join(app.getPath('userData'), 'data')) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  await startServer();
  menu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
