// Tema claro / escuro com um botão de ícone padrão (sol/lua).
import { html } from './html.js';
import { icon } from './icons.js';
import { lsGet, lsSet } from './prefs.js';
import { emit } from './events.js';

export const getTheme = () => document.documentElement.getAttribute('data-theme') || 'dark';

const THEME_COLOR = { light: '#D9CBE5', dark: '#0D0B12' };

function applyTheme(theme, persist) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) lsSet('dd.theme', theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(updateToggle);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[theme]));
  emit('theme', theme);
}

/**
 * Troca o tema. Com `animate`, a página inteira dissolve de forma uniforme do tema antigo para o novo
 * (View Transitions). Sem suporte: transição CSS das cores. Movimento reduzido: troca imediata.
 */
export function setTheme(theme, { persist = true, animate = false } = {}) {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce || getTheme() === theme) { applyTheme(theme, persist); return; }
  if (document.startViewTransition) {
    root.classList.add('theme-vt');
    const t = document.startViewTransition(() => applyTheme(theme, persist));
    t.finished.finally(() => root.classList.remove('theme-vt'));
    return;
  }
  root.classList.add('theme-fade');
  applyTheme(theme, persist);
  clearTimeout(setTheme.timer);
  setTheme.timer = setTimeout(() => root.classList.remove('theme-fade'), 900);
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark', { animate: true });
}

function updateToggle(btn) {
  const dark = getTheme() === 'dark';
  btn.setAttribute('aria-checked', String(dark));
  btn.title = dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
}

/** Botão padrão de tema: lua no tema claro (vai para o escuro), sol no escuro (vai para o claro). */
export function themeToggle() {
  return html`<button type="button" class="icon-btn theme-toggle" role="switch" aria-checked="${getTheme() === 'dark'}" aria-label="Tema escuro" data-theme-toggle>
    <span class="theme-toggle__moon">${icon('moon')}</span><span class="theme-toggle__sun">${icon('sun')}</span>
  </button>`;
}

export function initThemeToggles(root = document) {
  root.querySelectorAll('[data-theme-toggle]:not([data-bound])').forEach((btn) => {
    btn.dataset.bound = '1';
    updateToggle(btn);
    btn.addEventListener('click', () => toggleTheme());
  });
}

// Acompanha a preferência do sistema enquanto o usuário não escolher manualmente.
if (window.matchMedia) {
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', (e) => {
    if (!lsGet('dd.theme')) setTheme(e.matches ? 'light' : 'dark', { persist: false, animate: true });
  });
}
