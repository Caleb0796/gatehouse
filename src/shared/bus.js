const target = new EventTarget();
export const bus = {
  emit: (type, detail) => target.dispatchEvent(new CustomEvent(type, { detail })),
  on: (type, fn) => { const h = e => fn(e.detail); target.addEventListener(type, h); return () => target.removeEventListener(type, h); },
};
