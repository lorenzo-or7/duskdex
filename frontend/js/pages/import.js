// #/importar — leva os dados usados sem conta (IndexedDB deste navegador) para a conta no servidor.
// Etapas: cartas (validadas pelo servidor) → imagens (enviadas uma a uma) → coleção, fichários, decks e wishlist
// numa única transação no servidor. Os dados do navegador continuam guardados até a pessoa apagá-los.
import { html, render, plural } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, reloadCards, changed } from '../api/index.js';
import { DemoAdapter } from '../api/demo-adapter.js';
import { toast, toastError } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { navigate } from '../router.js';

async function guestSnapshot() {
  const demo = new DemoAdapter();
  await demo.init();
  const all = await demo.exportAll();
  const copies = (all.copies || []).filter((c) => c.status !== 'removed');
  return { demo, all, copies, examples: (all.cards || []).some((c) => c.source === 'demo-seed') };
}

/** Há algo do uso sem conta para levar para a conta? */
export async function guestHasData() {
  const { all, copies } = await guestSnapshot();
  return copies.length + (all.binders || []).length + (all.decks || []).length + (all.wishlist || []).length > 0;
}

export default async function importPage(ctx, main) {
  const db = data();
  if (db.mode !== 'server' || !db.user) { navigate('/entrar'); return; }
  const snap = await guestSnapshot();
  const { all, copies } = snap;
  const assets = all.assets || [];
  const total = copies.length + (all.binders || []).length + (all.decks || []).length + (all.wishlist || []).length;

  render(main, html`<div class="page" style="max-width:760px">
    <div class="page-head"><div><div class="page-head__eyebrow">Sua conta</div><h1>Trazer dados deste navegador</h1>
      <p>Você usou o DuskDex sem conta neste navegador. Dá para levar tudo para a conta <strong>@${db.user.username}</strong> — assim seus dados ficam no servidor e você acessa de qualquer aparelho.</p></div></div>
    <section class="panel stack">
      ${total ? html`<div class="import-summary">
          <div class="stat"><span class="stat__value">${copies.length}</span><span class="stat__label">cartas físicas</span></div>
          <div class="stat"><span class="stat__value">${(all.binders || []).length}</span><span class="stat__label">fichários</span></div>
          <div class="stat"><span class="stat__value">${(all.decks || []).length}</span><span class="stat__label">decks</span></div>
          <div class="stat"><span class="stat__value">${(all.wishlist || []).length}</span><span class="stat__label">na wishlist</span></div>
          <div class="stat"><span class="stat__value">${assets.length}</span><span class="stat__label">imagens</span></div>
        </div>
        ${snap.examples ? html`<div class="alert alert--warning">${icon('info')}<div>Estes dados incluem a <strong>coleção de exemplo</strong> (fictícia). Se não quiser levá-la, apague os dados do navegador em vez de importar.</div></div>` : ''}
        <p class="text-sm muted">Locais de armazenamento, fichários (com as cartas nos bolsos), decks e wishlist são copiados. O histórico de movimentações do navegador não é copiado: a importação vira um registro único no seu histórico. Reservas e montagens de deck chegam como listas virtuais.</p>
        <div data-progress hidden><div class="progress"><div class="progress__bar" data-bar style="width:0%"></div></div><p class="text-sm muted mt-2" data-step></p></div>
        <div class="btn-group">
          <button class="btn btn--primary btn--lg" type="button" data-go>${icon('upload')} Importar para minha conta</button>
          <a class="btn btn--ghost" href="#/inicio">Agora não</a>
          <button class="btn btn--ghost" type="button" data-wipe>${icon('trash')} Apagar dados do navegador</button>
        </div>`
    : html`<div class="state"><div class="state__icon">${icon('inbox')}</div><h3>Nada para importar</h3><p>Este navegador não tem dados do uso sem conta.</p><a class="btn btn--primary" href="#/inicio">Ir para a coleção</a></div>`}
    </section></div>`);

  const step = (pct, text) => {
    main.querySelector('[data-progress]').hidden = false;
    main.querySelector('[data-bar]').style.width = `${pct}%`;
    main.querySelector('[data-step]').textContent = text;
  };

  main.querySelector('[data-wipe]')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Apagar os dados deste navegador?', message: 'Coleção, fichários, decks, wishlist e imagens usados sem conta serão apagados deste navegador. Sua conta não é afetada.', danger: true, confirmLabel: 'Apagar' })) return;
    await snap.demo.reset();
    toast({ type: 'success', text: 'Dados do navegador apagados.' });
    navigate('/inicio');
  });

  main.querySelector('[data-go]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      // 1) cartas usadas (o servidor valida pela base TCGdex; personalizadas ficam privadas)
      const used = new Set([...copies.map((c) => c.cardKey), ...(all.wishlist || []).map((w) => w.cardKey), ...(all.decks || []).flatMap((d) => d.cards.map((l) => l.cardKey))]);
      for (const b of all.binders || []) { if (b.appearance?.coverCardKey) used.add(b.appearance.coverCardKey); for (const p of b.pages) for (const s of p.slots) if (s.cardKey) used.add(s.cardKey); }
      const cards = (all.cards || []).filter((c) => used.has(c.key));
      for (let i = 0; i < cards.length; i += 100) {
        step(Math.round((i / Math.max(1, cards.length)) * 30), `Registrando cartas… ${Math.min(i + 100, cards.length)}/${cards.length}`);
        await db.putCards(cards.slice(i, i + 100));
      }
      // 2) imagens (somente as usadas em fichários ou no perfil)
      const usedAssets = new Set();
      for (const b of all.binders || []) { if (b.appearance?.coverAssetId) usedAssets.add(b.appearance.coverAssetId); for (const p of b.pages) for (const s of p.slots) if (s.assetId) usedAssets.add(s.assetId); }
      const assetMap = {};
      const toSend = assets.filter((a) => usedAssets.has(a.id));
      for (const [i, a] of toSend.entries()) {
        step(30 + Math.round((i / Math.max(1, toSend.length)) * 40), `Enviando imagens… ${i + 1}/${toSend.length}`);
        const blob = await snap.demo.getAssetBlob(a.id);
        if (!blob) continue;
        const up = await db.addAsset({ blob, name: a.name, mime: a.mime });
        assetMap[a.id] = up.id;
      }
      // 3) coleção, fichários, decks e wishlist numa transação no servidor
      step(80, 'Importando coleção, fichários e decks…');
      const r = await db.importGuest({ locations: all.locations, copies: all.copies, binders: all.binders, decks: all.decks, wishlist: all.wishlist, assetMap });
      step(100, 'Pronto!');
      await reloadCards();
      changed('copies');
      const skipped = (r.skipped?.copies || 0) + (r.skipped?.slots || 0);
      toast({ type: 'success', title: 'Importação concluída', text: `${plural(r.copies, 'carta', 'cartas')}, ${plural(r.binders, 'fichário', 'fichários')} e ${plural(r.decks, 'deck', 'decks')} na sua conta.${skipped ? ` ${skipped} item(ns) sem dados válidos ficaram de fora.` : ''}`, timeout: 8000 });
      if (await confirmDialog({ title: 'Apagar a cópia do navegador?', message: 'Os dados já estão na sua conta. Quer apagar a cópia que ficou neste navegador? (Recomendado em computadores compartilhados.)', confirmLabel: 'Apagar do navegador', cancelLabel: 'Manter' })) await snap.demo.reset();
      navigate('/inicio');
    } catch (err) {
      toastError(err);
      btn.disabled = false;
      main.querySelector('[data-progress]').hidden = true;
    }
  });
}
