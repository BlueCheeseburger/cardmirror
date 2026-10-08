/**
 * The "which window?" chooser, drawn in CardMirror's own look instead of
 * a native macOS sheet (`dialog.showMessageBox`).
 *
 * It is a small frameless window that loads one self-contained HTML page
 * (no preload, no IPC): every pick is a navigation to a `cm-chooser:`
 * URL that main intercepts in `will-navigate`. `chooserHtml` is pure so
 * the markup is testable without Electron; `showChooserWindow` is the
 * thin Electron wrapper.
 *
 * Decoding stays in multipane-chooser.ts: this module reports the same
 * button index `dialog.showMessageBox` would have (`labels.length` is
 * "New Window", `labels.length + 1` is "Cancel"), so `readChooserResponse`
 * is shared unchanged.
 */

import { BrowserWindow, nativeTheme } from 'electron';

export const CHOOSER_SCHEME = 'cm-chooser:';

export interface ChooserHtmlOptions {
  message: string;
  labels: string[];
  withCancel: boolean;
  dark: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A window's label lists its docs joined by " · " — show them as lines. */
export function splitLabel(label: string): string[] {
  const parts = label.split(' · ').map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [label];
}

export function chooserHtml(opts: ChooserHtmlOptions): string {
  const rows = opts.labels
    .map((label, i) => {
      const docs = splitLabel(label)
        .map((d) => `<span class="doc">${esc(d)}</span>`)
        .join('');
      const key = i < 9 ? `<kbd>${i + 1}</kbd>` : '';
      return `<button class="row" data-pick="${i}" type="button"><span class="docs">${docs}</span>${key}</button>`;
    })
    .join('');
  const newIdx = opts.labels.length;
  const cancel = opts.withCancel
    ? `<button class="btn" data-pick="${newIdx + 1}" type="button">Cancel</button>`
    : '';
  return `<!doctype html>
<html data-theme="${opts.dark ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root{--bg:#fff;--bg-soft:#f7f7f8;--border:#d0d0d0;--text:#222;--muted:#666;--hover:#ebebeb;--accent:#2563eb;--accent-soft:rgba(37,99,235,.12)}
:root[data-theme="dark"]{--bg:#1a1a1a;--bg-soft:#222;--border:#3a3a3a;--text:#e6e6e6;--muted:#9a9a9a;--hover:#333;--accent:#5a8fff;--accent-soft:rgba(90,143,255,.18)}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--text);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-user-select:none;user-select:none}
.wrap{display:flex;flex-direction:column;height:100%;border:1px solid var(--border);padding:14px 16px 12px;gap:10px}
.drag{-webkit-app-region:drag}
h1{margin:0;font-size:15px;font-weight:700;line-height:1.3;word-break:break-word}
.sub{margin:-6px 0 0;color:var(--muted);font-size:12px}
.list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;min-height:0;flex:1}
.row{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-soft);cursor:pointer}
.row:hover{background:var(--hover)}
.row.sel{border-color:var(--accent);background:var(--accent-soft)}
.docs{display:flex;flex-direction:column;gap:2px;min-width:0}
.doc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
kbd{font:11px ui-monospace,Menlo,Consolas,monospace;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 5px;background:var(--bg)}
.actions{display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
.btn{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--bg-soft);color:var(--text);cursor:pointer}
.btn:hover{background:var(--hover)}
.btn.sel{border-color:var(--accent)}
</style></head><body>
<div class="wrap">
<h1 class="drag">${esc(opts.message)}</h1>
<p class="sub">Choose a window, or open it in a new one.</p>
<div class="list" id="list">${rows}</div>
<div class="actions">${cancel}<button class="btn" id="new" data-pick="${newIdx}" type="button">New Window</button></div>
</div>
<script>
var items=[].slice.call(document.querySelectorAll('.row'));
var sel=0;
function mark(){items.forEach(function(r,i){r.classList.toggle('sel',i===sel)});if(items[sel])items[sel].scrollIntoView({block:'nearest'});}
function pick(n){location.href='${CHOOSER_SCHEME}'+n;}
document.addEventListener('click',function(e){var b=e.target.closest('[data-pick]');if(b)pick(b.getAttribute('data-pick'));});
document.addEventListener('keydown',function(e){
 if(e.key==='Escape'){pick(${opts.withCancel ? newIdx + 1 : newIdx});return;}
 if(e.key==='Enter'){pick(items.length?sel:${newIdx});return;}
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!items.length)return;sel=(sel+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;mark();return;}
 if(/^[1-9]$/.test(e.key)&&Number(e.key)<=items.length){pick(Number(e.key)-1);}
});
mark();
</script></body></html>`;
}

/** Show the chooser and resolve with the picked button index, or the
 *  Esc-equivalent index when the window is closed some other way. */
export function showChooserWindow(opts: {
  message: string;
  labels: string[];
  withCancel: boolean;
}): Promise<number> {
  const escapeIndex = opts.labels.length + (opts.withCancel ? 1 : 0);
  return new Promise<number>((resolve) => {
    const rows = Math.min(opts.labels.length, 6);
    const lines = opts.labels.slice(0, 6).reduce((n, l) => n + splitLabel(l).length, 0);
    const win = new BrowserWindow({
      width: 460,
      height: Math.min(560, 150 + rows * 22 + lines * 18),
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: 'CardMirror',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let settled = false;
    const finish = (n: number): void => {
      if (settled) return;
      settled = true;
      resolve(n);
      if (!win.isDestroyed()) win.close();
    };
    win.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (!url.startsWith(CHOOSER_SCHEME)) return;
      const n = Number(url.slice(CHOOSER_SCHEME.length));
      finish(Number.isInteger(n) && n >= 0 && n <= escapeIndex ? n : escapeIndex);
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish(escapeIndex));
    win.once('ready-to-show', () => {
      win.center();
      win.show();
    });
    const html = chooserHtml({ ...opts, dark: nativeTheme.shouldUseDarkColors });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}
