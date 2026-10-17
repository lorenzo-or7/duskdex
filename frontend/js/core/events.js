// Barramento de eventos interno + aviso entre abas (BroadcastChannel).
const listeners = new Map();
let channel = null;
try { channel = 'BroadcastChannel' in window ? new BroadcastChannel('duskdex') : null; } catch { channel = null; }

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type, detail, { broadcast = false } = {}) {
  listeners.get(type)?.forEach((fn) => { try { fn(detail); } catch (e) { console.error(e); } });
  listeners.get('*')?.forEach((fn) => { try { fn({ type, detail }); } catch (e) { console.error(e); } });
  if (broadcast && channel) {
    try { channel.postMessage({ type, detail }); } catch { /* ignore */ }
  }
}

if (channel) {
  channel.onmessage = (ev) => {
    const { type, detail } = ev.data || {};
    if (!type) return;
    listeners.get('remote:' + type)?.forEach((fn) => fn(detail));
    listeners.get('remote:*')?.forEach((fn) => fn({ type, detail }));
  };
}
