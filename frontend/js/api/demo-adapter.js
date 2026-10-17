// Adaptador do USO SEM CONTA: todos os dados ficam no IndexedDB deste navegador.
// Não há sincronização online. Regras físicas (uma posição por cópia, um bolso por cópia,
// histórico imutável, reversão por operação compensatória) são aplicadas em transações atômicas.
import { tx, openDB, wipe, getAll, get } from '../stores/db.js';
import { uid } from '../core/html.js';
import { DomainError, ConflictError } from './errors.js';
import { makePage, canPlace, sameSlot, revertConflicts, cardKeyOf } from '../features/domain.js';
import { CONDITION_IDS } from '../features/conditions.js';

const now = () => new Date().toISOString();
const SYS_INBOX = 'loc_inbox';
const SYS_REMOVED = 'loc_removed';

export const LOCATION_KINDS = {
  system: 'Sistema', room: 'Cômodo', shelf: 'Estante', drawer: 'Gaveta', box: 'Caixa', folder: 'Pasta',
  divider: 'Divisória', binder: 'Fichário', deck_box: 'Deck box', custom: 'Personalizado',
};

function findSlot(binder, pageId, index) {
  const page = binder.pages.find((p) => p.id === pageId);
  if (!page) throw new DomainError('PAGE_NOT_FOUND', 'Página não encontrada no fichário.');
  if (index < 0 || index >= page.slots.length) throw new DomainError('SLOT_NOT_FOUND', 'Bolso inexistente nesta página.');
  return { page, slot: page.slots[index] };
}
const slotRef = (binderId, pageId, index) => ({ binderId, pageId, index });
const pageNumber = (binder, pageId) => binder.pages.findIndex((p) => p.id === pageId) + 1;

export class DemoAdapter {
  constructor() {
    this.mode = 'demo';
    this.label = 'Sem conta (neste navegador)';
    this.capabilities = { inventory: true, assets: true, community: false, deckAssembly: true, auth: false, revert: true, trades: false };
  }

  async init() {
    await openDB();
    const meta = await get('meta', 'seeded');
    return { seeded: !!meta };
  }

  // ---------------------------------------------------------------- meta
  async markSeeded() { await tx('meta', 'readwrite', (s) => s.meta.put({ key: 'seeded', at: now() })); }
  async reset() { await wipe(); }
  async storageEstimate() {
    try { return await navigator.storage?.estimate?.(); } catch { return null; }
  }

  // ---------------------------------------------------------------- cartas (snapshots locais)
  async putCards(snaps) {
    const list = snaps.filter(Boolean);
    await tx('cards', 'readwrite', async (s) => { for (const c of list) await s.cards.put({ ...c, key: c.key || cardKeyOf(c.id, c.lang) }); });
    return list.map((c) => ({ ...c, key: c.key || cardKeyOf(c.id, c.lang) }));
  }
  allCards() { return getAll('cards'); }

  // ---------------------------------------------------------------- perfil
  async getProfile() {
    return (await get('meta', 'profile'))?.value || null;
  }
  async saveProfile(patch) {
    return tx('meta', 'readwrite', async (s) => {
      const cur = (await s.meta.get('profile'))?.value || {};
      const value = { ...cur, ...patch, updatedAt: now() };
      await s.meta.put({ key: 'profile', value });
      return value;
    });
  }

  // ---------------------------------------------------------------- atividade
  async listActivity(limit = 30) {
    const all = await getAll('activity');
    return all.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  }
  _activity(s, type, text, extra = {}) {
    return s.activity.put({ id: uid('act_'), at: now(), type, text, ...extra });
  }

  // ---------------------------------------------------------------- locais
  async ensureSystemLocations() {
    await tx('locations', 'readwrite', async (s) => {
      if (!(await s.locations.get(SYS_INBOX))) await s.locations.put({ id: SYS_INBOX, name: 'Sem local definido', kind: 'system', parentId: null, system: true, description: 'Cartas recém-cadastradas ficam aqui até você escolher um local.', createdAt: now() });
      if (!(await s.locations.get(SYS_REMOVED))) await s.locations.put({ id: SYS_REMOVED, name: 'Fora da coleção', kind: 'system', parentId: null, system: true, hidden: true, description: 'Cópias removidas (vendidas, trocadas, perdidas). O histórico é preservado.', createdAt: now() });
    });
  }
  get inboxId() { return SYS_INBOX; }
  get removedId() { return SYS_REMOVED; }

  listLocations() { return getAll('locations'); }

  async createLocation({ name, kind = 'custom', parentId = null, description = '', capacity = null }) {
    name = String(name || '').trim();
    if (!name) throw new DomainError('VALIDATION', 'Dê um nome ao local.');
    if (name.length > 60) throw new DomainError('VALIDATION', 'Nome muito longo (máx. 60).');
    return tx(['locations', 'activity'], 'readwrite', async (s) => {
      if (parentId) {
        const p = await s.locations.get(parentId);
        if (!p) throw new DomainError('NOT_FOUND', 'Local pai não encontrado.');
        if (p.id === SYS_REMOVED) throw new DomainError('VALIDATION', 'Não é possível criar locais dentro de “Fora da coleção”.');
      }
      const loc = { id: uid('loc_'), name, kind, parentId, description, capacity: capacity ? Number(capacity) : null, createdAt: now() };
      await s.locations.put(loc);
      await this._activity(s, 'location', `Local “${name}” criado`, { icon: 'box' });
      return loc;
    });
  }

  async updateLocation(id, patch) {
    return tx('locations', 'readwrite', async (s) => {
      const loc = await s.locations.get(id);
      if (!loc) throw new DomainError('NOT_FOUND', 'Local não encontrado.');
      if (loc.system) throw new DomainError('FORBIDDEN', 'Locais do sistema não podem ser editados.');
      const next = { ...loc, ...patch };
      if ('name' in patch && !String(patch.name || '').trim()) throw new DomainError('VALIDATION', 'O nome não pode ficar vazio.');
      if (patch.parentId !== undefined && patch.parentId !== loc.parentId) {
        // Impede hierarquia circular: o novo pai não pode ser o próprio local nem um descendente.
        const all = await s.locations.getAll();
        let cur = patch.parentId;
        while (cur) {
          if (cur === id) throw new DomainError('CYCLE', 'Um local não pode ficar dentro de si mesmo ou de um de seus sublocais.');
          cur = all.find((l) => l.id === cur)?.parentId || null;
        }
      }
      await s.locations.put(next);
      return next;
    });
  }

  async deleteLocation(id) {
    return tx(['locations', 'copies', 'binders', 'activity'], 'readwrite', async (s) => {
      const loc = await s.locations.get(id);
      if (!loc) throw new DomainError('NOT_FOUND', 'Local não encontrado.');
      if (loc.system) throw new DomainError('FORBIDDEN', 'Locais do sistema não podem ser excluídos.');
      if (loc.binderId) throw new DomainError('FORBIDDEN', 'Este local pertence a um fichário físico. Exclua o fichário para removê-lo.');
      if (loc.deckId) throw new DomainError('FORBIDDEN', 'Este local pertence a um deck montado. Desmonte o deck primeiro.');
      const all = await s.locations.getAll();
      if (all.some((l) => l.parentId === id)) throw new DomainError('NOT_EMPTY', 'Mova ou exclua os sublocais antes.');
      const copies = await s.copies.byIndex('locationId', id);
      if (copies.some((c) => c.status !== 'removed')) throw new DomainError('NOT_EMPTY', `Há ${copies.length} carta(s) neste local. Mova-as antes de excluir.`);
      await s.locations.del(id);
      await this._activity(s, 'location', `Local “${loc.name}” excluído`, { icon: 'trash' });
      return true;
    });
  }

  // ---------------------------------------------------------------- cópias
  listCopies() { return getAll('copies'); }

  /**
   * Cria N cópias individuais (uma linha por carta física) e registra um lote de aquisição.
   * items: [{ cardKey, cardId, lang, finish, qty, custom }]
   */
  async addCopies(items, { locationId = SYS_INBOX, label } = {}) {
    const valid = items.filter((i) => i.qty > 0);
    if (!valid.length) throw new DomainError('VALIDATION', 'Informe pelo menos uma cópia.');
    for (const i of valid) {
      if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) throw new DomainError('VALIDATION', 'Quantidade deve ser um inteiro entre 1 e 99 por carta.');
    }
    return tx(['copies', 'locations', 'batches', 'activity'], 'readwrite', async (s) => {
      const loc = await s.locations.get(locationId);
      if (!loc || loc.id === SYS_REMOVED) throw new DomainError('VALIDATION', 'Local de destino inválido.');
      if (loc.deckId) throw new DomainError('VALIDATION', 'Para colocar cartas em um deck montado use o fluxo de montagem do deck.');
      const batch = { id: uid('bat_'), type: 'acquire', label: label || 'Cadastro de cartas', createdAt: now(), movements: [] };
      const created = [];
      for (const i of valid) {
        for (let n = 0; n < i.qty; n++) {
          const c = { id: uid('cp_'), cardKey: i.cardKey, cardId: i.cardId, lang: i.lang, finish: i.finish || 'normal', condition: CONDITION_IDS.includes(i.condition) ? i.condition : 'NM', custom: !!i.custom, status: 'active', locationId, slot: null, reservedFor: null, deckAssembled: false, createdAt: now(), updatedAt: now() };
          await s.copies.put(c);
          created.push(c);
          batch.movements.push({ id: uid('mv_'), copyId: c.id, cardKey: c.cardKey, from: { locationId: null, slot: null }, to: { locationId, slot: null } });
        }
      }
      await s.batches.put(batch);
      await this._activity(s, 'acquire', `${created.length} cópia(s) cadastrada(s) em “${loc.name}”`, { icon: 'plus', batchId: batch.id });
      return { batch, copies: created };
    });
  }

  /** Altera o estado de conservação (M, NM, SP, MP, HP, D, HD) de cópias ativas. */
  async setCondition(copyIds, condition) {
    if (!CONDITION_IDS.includes(condition)) throw new DomainError('VALIDATION', 'Estado de conservação inválido.');
    return tx(['copies'], 'readwrite', async (s) => {
      let n = 0;
      for (const id of copyIds) {
        const c = await s.copies.get(id);
        if (!c || c.status !== 'active') continue;
        await s.copies.put({ ...c, condition, updatedAt: now() }); n++;
      }
      return { updated: n };
    });
  }

  /** Remove cópias da coleção (status removed + movimento para “Fora da coleção”). Libera bolsos e reservas. */
  async removeCopies(copyIds, { reason = 'Removida da coleção' } = {}) {
    if (!copyIds.length) return null;
    return tx(['copies', 'binders', 'batches', 'activity', 'locations'], 'readwrite', async (s) => {
      const batch = { id: uid('bat_'), type: 'remove', label: reason, createdAt: now(), movements: [] };
      const touched = new Map();
      for (const id of copyIds) {
        const c = await s.copies.get(id);
        if (!c || c.status === 'removed') continue;
        if (c.deckAssembled) throw new DomainError('IN_DECK', 'Uma das cópias está montada em um deck físico. Desmonte o deck antes de removê-la.');
        if (c.slot) await this._clearSlotForCopy(s, c, touched);
        batch.movements.push({ id: uid('mv_'), copyId: c.id, cardKey: c.cardKey, from: { locationId: c.locationId, slot: c.slot }, to: { locationId: SYS_REMOVED, slot: null } });
        await s.copies.put({ ...c, status: 'removed', locationId: SYS_REMOVED, slot: null, reservedFor: null, updatedAt: now() });
      }
      for (const b of touched.values()) await s.binders.put({ ...b, version: b.version + 1, updatedAt: now() });
      if (!batch.movements.length) return null;
      await s.batches.put(batch);
      await this._activity(s, 'remove', `${batch.movements.length} cópia(s) removida(s) da coleção`, { icon: 'trash', batchId: batch.id });
      return batch;
    });
  }

  async _clearSlotForCopy(s, copy, touched) {
    const b = touched.get(copy.slot.binderId) || await s.binders.get(copy.slot.binderId);
    if (!b) return;
    const page = b.pages.find((p) => p.id === copy.slot.pageId);
    const slot = page?.slots[copy.slot.index];
    if (slot && slot.kind === 'copy' && slot.copyId === copy.id) page.slots[copy.slot.index] = { kind: 'empty', locked: slot.locked };
    touched.set(b.id, b);
  }

  // ---------------------------------------------------------------- movimentações
  async previewMove(copyIds, locationId) {
    const [copies, locations, binders] = await Promise.all([getAll('copies'), getAll('locations'), getAll('binders')]);
    const dest = locations.find((l) => l.id === locationId);
    if (!dest || dest.id === SYS_REMOVED) throw new DomainError('VALIDATION', 'Escolha um destino válido.');
    const items = []; const blocked = [];
    for (const id of copyIds) {
      const c = copies.find((x) => x.id === id);
      if (!c || c.status === 'removed') continue;
      const from = locations.find((l) => l.id === c.locationId);
      const binder = c.slot ? binders.find((b) => b.id === c.slot.binderId) : null;
      const where = c.slot && binder ? `${binder.name} · pág. ${pageNumber(binder, c.slot.pageId)} · bolso ${c.slot.index + 1}` : from?.name || '—';
      if (c.deckAssembled) { blocked.push({ copy: c, reason: 'Montada em deck físico — desmonte o deck antes.' }); continue; }
      if (c.locationId === locationId && !c.slot) { blocked.push({ copy: c, reason: 'Já está neste local.' }); continue; }
      if (dest.binderId) { blocked.push({ copy: c, reason: 'Para colocar em um fichário, use o editor do fichário (escolha o bolso).' }); continue; }
      if (dest.deckId) { blocked.push({ copy: c, reason: 'Use a montagem do deck para movê-la para um deck.' }); continue; }
      items.push({ copy: c, from: where, warning: c.reservedFor ? 'Reservada para um deck (a reserva continua).' : c.slot ? 'O bolso de origem ficará vazio.' : null });
    }
    const capacityWarn = dest.capacity ? (() => {
      const count = copies.filter((c) => c.locationId === dest.id && c.status !== 'removed').length;
      return count + items.length > dest.capacity ? `O destino tem capacidade para ${dest.capacity} e ficará com ${count + items.length}.` : null;
    })() : null;
    return { dest, items, blocked, capacityWarn, token: copyIds.map((id) => { const c = copies.find((x) => x.id === id); return c ? `${id}@${c.locationId}@${c.slot ? `${c.slot.binderId}/${c.slot.pageId}/${c.slot.index}` : ''}` : id; }).join(',') };
  }

  /** Confirma uma movimentação. `token` vem da prévia: se o estado mudou desde então, a operação é recusada. */
  async commitMove(copyIds, locationId, { token, idempotencyKey } = {}) {
    return tx(['copies', 'locations', 'binders', 'batches', 'activity'], 'readwrite', async (s) => {
      if (idempotencyKey) {
        const existing = (await s.batches.getAll()).find((b) => b.idempotencyKey === idempotencyKey);
        if (existing) return existing; // repetição segura
      }
      const dest = await s.locations.get(locationId);
      if (!dest || dest.id === SYS_REMOVED || dest.binderId || dest.deckId) throw new DomainError('VALIDATION', 'Destino inválido para movimentação direta.');
      const batch = { id: uid('bat_'), type: 'move', label: `Movimentação para “${dest.name}”`, createdAt: now(), movements: [], idempotencyKey: idempotencyKey || null };
      const touched = new Map();
      const sorted = [...copyIds].sort();
      const current = [];
      for (const id of sorted) current.push(await s.copies.get(id));
      if (token) {
        const nowToken = copyIds.map((id) => { const c = current.find((x) => x?.id === id); return c ? `${id}@${c.locationId}@${c.slot ? `${c.slot.binderId}/${c.slot.pageId}/${c.slot.index}` : ''}` : id; }).join(',');
        if (nowToken !== token) throw new ConflictError('Algumas cartas mudaram de lugar depois da prévia. Gere a prévia novamente.');
      }
      for (const c of current) {
        if (!c || c.status === 'removed' || c.deckAssembled) continue;
        if (c.locationId === locationId && !c.slot) continue;
        if (c.slot) await this._clearSlotForCopy(s, c, touched);
        batch.movements.push({ id: uid('mv_'), copyId: c.id, cardKey: c.cardKey, from: { locationId: c.locationId, slot: c.slot }, to: { locationId, slot: null } });
        await s.copies.put({ ...c, locationId, slot: null, updatedAt: now() });
      }
      if (!batch.movements.length) throw new DomainError('NOTHING', 'Nenhuma carta precisou ser movida.');
      for (const b of touched.values()) await s.binders.put({ ...b, version: b.version + 1, updatedAt: now() });
      await s.batches.put(batch);
      await this._activity(s, 'move', `${batch.movements.length} carta(s) movida(s) para “${dest.name}”`, { icon: 'move', batchId: batch.id });
      return batch;
    });
  }

  async listBatches() {
    const all = await getAll('batches');
    return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Prévia de reversão: verifica posição atual, reservas e conflitos posteriores de cada movimento. */
  async previewRevert(batchId) {
    const [batch, copies, locations, binders] = await Promise.all([get('batches', batchId), getAll('copies'), getAll('locations'), getAll('binders')]);
    if (!batch) throw new DomainError('NOT_FOUND', 'Operação não encontrada.');
    const reverted = new Set(batch.revertedMovementIds || []);
    const ctx = this._revertCtx(locations, binders);
    const items = batch.movements.map((m) => {
      if (reverted.has(m.id)) return { movement: m, conflicts: ['Este movimento já foi revertido.'], already: true };
      const copy = copies.find((c) => c.id === m.copyId);
      return { movement: m, copy, conflicts: revertConflicts(m, copy, ctx) };
    });
    return { batch, items };
  }

  _revertCtx(locations, binders) {
    return {
      locationExists: (id) => locations.some((l) => l.id === id),
      binderExists: (id) => binders.some((b) => b.id === id),
      slotOccupant: (ref) => {
        const b = binders.find((x) => x.id === ref.binderId);
        const slot = b?.pages.find((p) => p.id === ref.pageId)?.slots[ref.index];
        if (!slot) return 'missing';
        if (slot.kind === 'copy') return slot.copyId;
        if (slot.kind === 'empty' || slot.kind === 'ghost') return null;
        return 'other';
      },
      slotLocked: (ref) => {
        const b = binders.find((x) => x.id === ref.binderId);
        return !!b?.pages.find((p) => p.id === ref.pageId)?.slots[ref.index]?.locked;
      },
    };
  }

  /** Reverte (total ou parcialmente) gerando um NOVO lote compensatório. O histórico original permanece. */
  async revertBatch(batchId, movementIds) {
    return tx(['batches', 'copies', 'locations', 'binders', 'activity'], 'readwrite', async (s) => {
      const batch = await s.batches.get(batchId);
      if (!batch) throw new DomainError('NOT_FOUND', 'Operação não encontrada.');
      const [locations, bindersArr] = [await s.locations.getAll(), await s.binders.getAll()];
      const binders = new Map(bindersArr.map((b) => [b.id, b]));
      const ctx = this._revertCtx(locations, [...binders.values()]);
      const rev = { id: uid('bat_'), type: 'revert', label: `Reversão de “${batch.label}”`, revertsBatchId: batch.id, createdAt: now(), movements: [] };
      const done = new Set(batch.revertedMovementIds || []);
      const touched = new Map();
      for (const m of batch.movements) {
        if (!movementIds.includes(m.id) || done.has(m.id)) continue;
        const copy = await s.copies.get(m.copyId);
        const conflicts = revertConflicts(m, copy, ctx);
        if (conflicts.length) throw new ConflictError(`Não é possível reverter: ${conflicts[0]}`, conflicts);
        // origem nula = aquisição → a compensação é retirar a cópia da coleção
        const target = m.from.locationId ? { locationId: m.from.locationId, slot: m.from.slot } : { locationId: SYS_REMOVED, slot: null };
        if (copy.slot) {
          const b = touched.get(copy.slot.binderId) || binders.get(copy.slot.binderId);
          const pg = b?.pages.find((p) => p.id === copy.slot.pageId);
          if (pg && pg.slots[copy.slot.index]?.copyId === copy.id) pg.slots[copy.slot.index] = { kind: 'empty', locked: pg.slots[copy.slot.index].locked };
          if (b) touched.set(b.id, b);
        }
        if (target.slot) {
          const b = touched.get(target.slot.binderId) || binders.get(target.slot.binderId);
          const pg = b.pages.find((p) => p.id === target.slot.pageId);
          pg.slots[target.slot.index] = { kind: 'copy', copyId: copy.id, cardKey: copy.cardKey, locked: false };
          touched.set(b.id, b);
        }
        const next = {
          ...copy,
          locationId: target.locationId,
          slot: target.slot || null,
          status: target.locationId === SYS_REMOVED ? 'removed' : 'active',
          deckAssembled: false,
          updatedAt: now(),
        };
        await s.copies.put(next);
        rev.movements.push({ id: uid('mv_'), copyId: copy.id, cardKey: copy.cardKey, from: { locationId: copy.locationId, slot: copy.slot }, to: { locationId: next.locationId, slot: next.slot }, revertsMovementId: m.id });
        done.add(m.id);
      }
      if (!rev.movements.length) throw new DomainError('NOTHING', 'Nenhum movimento selecionado pôde ser revertido.');
      for (const b of touched.values()) await s.binders.put({ ...b, version: b.version + 1, updatedAt: now() });
      await s.batches.put({ ...batch, revertedMovementIds: [...done] });
      await s.batches.put(rev);
      await this._activity(s, 'revert', `${rev.movements.length} movimento(s) revertido(s) de “${batch.label}”`, { icon: 'undo', batchId: rev.id });
      return rev;
    });
  }

  // ---------------------------------------------------------------- fichários
  async listBinders() {
    const all = await getAll('binders');
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  getBinder(id) { return get('binders', id); }

  async createBinder(data) {
    const name = String(data.name || '').trim();
    if (!name) throw new DomainError('VALIDATION', 'Dê um nome ao fichário.');
    const rows = Number(data.rows); const cols = Number(data.cols);
    if (!(rows >= 1 && rows <= 6 && cols >= 1 && cols <= 6)) throw new DomainError('VALIDATION', 'Formato de página inválido (1 a 6 linhas/colunas).');
    const pagesCount = Math.min(200, Math.max(1, Number(data.pages) || 10));
    return tx(['binders', 'locations', 'activity'], 'readwrite', async (s) => {
      const id = uid('bnd_');
      let locationId = null;
      if (data.type === 'physical') {
        locationId = uid('loc_');
        await s.locations.put({ id: locationId, name, kind: 'binder', parentId: data.parentLocationId || null, binderId: id, description: 'Local criado automaticamente para o fichário físico.', createdAt: now() });
      }
      const binder = {
        id, name, description: String(data.description || '').slice(0, 500), type: data.type === 'physical' ? 'physical' : 'virtual',
        layout: { rows, cols }, pages: Array.from({ length: pagesCount }, () => makePage(rows, cols)),
        appearance: { color: data.color || '#4b2f5e', sheetColor: data.sheetColor || '#1a1420', style: data.style || 'classico', slotStyle: data.slotStyle || 'rounded', coverAssetId: data.coverAssetId || null, coverCardKey: data.coverCardKey || null, firstPageRight: !!data.firstPageRight },
        locationId, visibility: data.visibility || 'private', favorite: !!data.favorite,
        version: 1, createdAt: now(), updatedAt: now(),
      };
      await s.binders.put(binder);
      await this._activity(s, 'binder', `Fichário ${binder.type === 'physical' ? 'físico' : 'virtual'} “${name}” criado`, { icon: 'book', binderId: id });
      return binder;
    });
  }

  async updateBinderMeta(id, patch, expectedVersion) {
    return tx(['binders', 'locations'], 'readwrite', async (s) => {
      const b = await s.binders.get(id);
      if (!b) throw new DomainError('NOT_FOUND', 'Fichário não encontrado.');
      if (expectedVersion != null && b.version !== expectedVersion) throw new ConflictError();
      const allowed = ['name', 'description', 'visibility', 'favorite'];
      const next = { ...b };
      for (const k of allowed) if (k in patch) next[k] = patch[k];
      if (patch.appearance) next.appearance = { ...b.appearance, ...patch.appearance };
      if ('name' in patch && !String(patch.name).trim()) throw new DomainError('VALIDATION', 'O nome não pode ficar vazio.');
      next.version = b.version + 1; next.updatedAt = now();
      await s.binders.put(next);
      if (b.locationId && patch.name) {
        const loc = await s.locations.get(b.locationId);
        if (loc) await s.locations.put({ ...loc, name: patch.name });
      }
      return next;
    });
  }

  /** Exclui o fichário. Se for físico e tiver cartas, elas são movidas para `moveCopiesTo` (lote registrado). */
  async deleteBinder(id, { moveCopiesTo = SYS_INBOX } = {}) {
    return tx(['binders', 'copies', 'locations', 'batches', 'activity'], 'readwrite', async (s) => {
      const b = await s.binders.get(id);
      if (!b) throw new DomainError('NOT_FOUND', 'Fichário não encontrado.');
      const all = await s.copies.getAll();
      const inside = all.filter((c) => c.slot?.binderId === id && c.status !== 'removed');
      if (inside.length) {
        const dest = await s.locations.get(moveCopiesTo);
        if (!dest || dest.binderId === id) throw new DomainError('VALIDATION', 'Escolha para onde as cartas do fichário vão.');
        const batch = { id: uid('bat_'), type: 'move', label: `Esvaziar fichário “${b.name}”`, createdAt: now(), movements: [] };
        for (const c of inside) {
          batch.movements.push({ id: uid('mv_'), copyId: c.id, cardKey: c.cardKey, from: { locationId: c.locationId, slot: c.slot }, to: { locationId: moveCopiesTo, slot: null } });
          await s.copies.put({ ...c, locationId: moveCopiesTo, slot: null, updatedAt: now() });
        }
        await s.batches.put(batch);
      }
      if (b.locationId) await s.locations.del(b.locationId);
      await s.binders.del(id);
      await this._activity(s, 'binder', `Fichário “${b.name}” excluído${inside.length ? ` (${inside.length} carta(s) movida(s))` : ''}`, { icon: 'trash' });
      return true;
    });
  }

  /** Copia a estrutura como novo fichário VIRTUAL (cópias físicas viram referências; nada é duplicado no inventário). */
  async duplicateAsVirtual(id, name) {
    const b = await this.getBinder(id);
    if (!b) throw new DomainError('NOT_FOUND', 'Fichário não encontrado.');
    const nb = await this.createBinder({ name: name || `${b.name} (cópia virtual)`, type: 'virtual', rows: b.layout.rows, cols: b.layout.cols, pages: 1, color: b.appearance.color, sheetColor: b.appearance.sheetColor, style: b.appearance.style });
    nb.pages = b.pages.map((p) => ({ id: makePage(p.rows, p.cols).id, rows: p.rows, cols: p.cols, slots: p.slots.map((sl) => (sl.kind === 'copy' ? { kind: 'virtual', cardKey: sl.cardKey, locked: sl.locked } : { ...sl })) }));
    await tx('binders', 'readwrite', (s) => s.binders.put({ ...nb, version: nb.version + 1 }));
    return nb;
  }

  /**
   * Aplica operações de edição em um fichário de forma ATÔMICA.
   * Qualquer violação de regra desfaz todas as operações do pedido.
   */
  async binderOps(binderId, ops, { expectedVersion = null, label = 'Edição de fichário' } = {}) {
    return tx(['binders', 'copies', 'locations', 'batches', 'activity'], 'readwrite', async (s) => {
      const b = await s.binders.get(binderId);
      if (!b) throw new DomainError('NOT_FOUND', 'Fichário não encontrado.');
      if (expectedVersion != null && b.version !== expectedVersion) throw new ConflictError();
      const batch = { id: uid('bat_'), type: 'reorganize', label: `${label} · ${b.name}`, createdAt: now(), movements: [] };
      const copyCache = new Map();
      const getCopy = async (id) => { if (!copyCache.has(id)) copyCache.set(id, await s.copies.get(id)); return copyCache.get(id); };
      const otherBinders = new Map();
      const record = (copy, from, to) => batch.movements.push({ id: uid('mv_'), copyId: copy.id, cardKey: copy.cardKey, from, to });

      const setCopySlot = async (copy, ref) => {
        const from = { locationId: copy.locationId, slot: copy.slot };
        const to = { locationId: b.locationId, slot: ref };
        if (!sameSlot(from.slot, to.slot) || from.locationId !== to.locationId) record(copy, from, to);
        copyCache.set(copy.id, { ...copy, locationId: b.locationId, slot: ref, updatedAt: now() });
      };

      for (const op of ops) {
        switch (op.op) {
          case 'set': {
            const { slot } = findSlot(b, op.pageId, op.index);
            if (slot.kind === 'copy') throw new DomainError('HAS_COPY', 'Este bolso tem uma carta física. Retire-a primeiro (ela precisa de um destino).');
            const kind = op.slot.kind;
            if (!canPlace(b.type, kind)) throw new DomainError('NOT_ALLOWED', kind === 'virtual' ? 'Referências virtuais são para fichários virtuais. Em fichários físicos use uma carta fantasma.' : 'Cartas físicas só podem ser colocadas em fichários físicos.');
            if (slot.locked && kind !== 'ghost' && kind !== 'empty') throw new DomainError('LOCKED', 'Bolso bloqueado: só aceita carta fantasma. Desbloqueie para colocar outro conteúdo.');
            const page = b.pages.find((p) => p.id === op.pageId);
            page.slots[op.index] = { ...op.slot, locked: slot.locked };
            break;
          }
          case 'place': {
            if (b.type !== 'physical') throw new DomainError('NOT_ALLOWED', 'Fichários virtuais não recebem cópias físicas.');
            const { page, slot } = findSlot(b, op.pageId, op.index);
            if (slot.locked) throw new DomainError('LOCKED', 'Bolso bloqueado. Desbloqueie para colocar uma carta física.');
            if (slot.kind === 'copy') throw new DomainError('OCCUPIED', 'Este bolso já tem uma carta física.');
            if (slot.kind === 'image' || slot.kind === 'virtual') throw new DomainError('OCCUPIED', 'Este bolso tem outro conteúdo. Esvazie-o antes.');
            const copy = await getCopy(op.copyId);
            if (!copy || copy.status === 'removed') throw new DomainError('NOT_FOUND', 'Cópia não encontrada na coleção.');
            if (copy.deckAssembled) throw new DomainError('IN_DECK', 'Esta cópia está montada em um deck físico.');
            // Se já estiver em outro bolso (deste ou de outro fichário), o bolso anterior é liberado na MESMA transação.
            if (copy.slot) {
              if (copy.slot.binderId === b.id) {
                const prev = b.pages.find((p) => p.id === copy.slot.pageId);
                if (prev && prev.slots[copy.slot.index]?.copyId === copy.id) prev.slots[copy.slot.index] = { kind: 'empty', locked: prev.slots[copy.slot.index].locked };
              } else {
                const ob = otherBinders.get(copy.slot.binderId) || await s.binders.get(copy.slot.binderId);
                const prev = ob?.pages.find((p) => p.id === copy.slot.pageId);
                if (prev && prev.slots[copy.slot.index]?.copyId === copy.id) prev.slots[copy.slot.index] = { kind: 'empty', locked: prev.slots[copy.slot.index].locked };
                if (ob) otherBinders.set(ob.id, ob);
              }
            }
            page.slots[op.index] = { kind: 'copy', copyId: copy.id, cardKey: copy.cardKey, locked: false };
            await setCopySlot(copy, slotRef(b.id, op.pageId, op.index));
            break;
          }
          case 'unplace': {
            const { page, slot } = findSlot(b, op.pageId, op.index);
            if (slot.kind !== 'copy') { page.slots[op.index] = { kind: 'empty', locked: slot.locked }; break; }
            const dest = await s.locations.get(op.toLocationId || SYS_INBOX);
            if (!dest || dest.id === SYS_REMOVED || dest.binderId || dest.deckId) throw new DomainError('VALIDATION', 'Destino inválido para a carta retirada.');
            const copy = await getCopy(slot.copyId);
            page.slots[op.index] = op.leaveGhost ? { kind: 'ghost', cardKey: slot.cardKey, locked: slot.locked } : { kind: 'empty', locked: slot.locked };
            if (copy) {
              record(copy, { locationId: copy.locationId, slot: copy.slot }, { locationId: dest.id, slot: null });
              copyCache.set(copy.id, { ...copy, locationId: dest.id, slot: null, updatedAt: now() });
            }
            break;
          }
          case 'swap':
          case 'move': {
            const A = findSlot(b, op.a.pageId, op.a.index);
            const B = findSlot(b, op.b.pageId, op.b.index);
            if (A.slot.locked || B.slot.locked) {
              // Slot bloqueado só pode receber/ceder fantasma.
              const movingIntoLocked = (B.slot.locked && A.slot.kind !== 'ghost' && A.slot.kind !== 'empty') || (A.slot.locked && B.slot.kind !== 'ghost' && B.slot.kind !== 'empty');
              if (movingIntoLocked) throw new DomainError('LOCKED', 'Bolsos bloqueados só aceitam cartas fantasmas.');
            }
            if (op.op === 'move' && B.slot.kind !== 'empty') throw new DomainError('OCCUPIED', 'O destino não está vazio. Use “trocar”.');
            const sa = { ...A.slot, locked: B.slot.locked }; const sb = { ...B.slot, locked: A.slot.locked };
            A.page.slots[op.a.index] = sb; B.page.slots[op.b.index] = sa;
            if (sa.kind === 'copy') await setCopySlot(await getCopy(sa.copyId), slotRef(b.id, op.b.pageId, op.b.index));
            if (sb.kind === 'copy') await setCopySlot(await getCopy(sb.copyId), slotRef(b.id, op.a.pageId, op.a.index));
            break;
          }
          case 'lock': {
            const { page, slot } = findSlot(b, op.pageId, op.index);
            if (op.locked && slot.kind !== 'empty' && slot.kind !== 'ghost') throw new DomainError('NOT_ALLOWED', 'Só é possível bloquear bolsos vazios ou com carta fantasma.');
            page.slots[op.index] = { ...slot, locked: !!op.locked };
            break;
          }
          case 'addPage': {
            const rows = Number(op.rows) || b.layout.rows; const cols = Number(op.cols) || b.layout.cols;
            if (rows < 1 || rows > 6 || cols < 1 || cols > 6) throw new DomainError('VALIDATION', 'Formato inválido.');
            if (b.pages.length >= 200) throw new DomainError('LIMIT', 'Limite de 200 páginas por fichário.');
            const idx = op.afterPageId ? b.pages.findIndex((p) => p.id === op.afterPageId) + 1 : b.pages.length;
            b.pages.splice(idx, 0, makePage(rows, cols));
            break;
          }
          case 'removePage': {
            const page = b.pages.find((p) => p.id === op.pageId);
            if (!page) throw new DomainError('PAGE_NOT_FOUND', 'Página não encontrada.');
            if (page.slots.some((x) => x.kind === 'copy')) throw new DomainError('HAS_COPY', 'A página tem cartas físicas. Retire-as antes de excluir a página.');
            if (b.pages.length === 1) throw new DomainError('LIMIT', 'O fichário precisa ter ao menos uma página.');
            b.pages = b.pages.filter((p) => p.id !== op.pageId);
            break;
          }
          case 'layoutPage': {
            const page = b.pages.find((p) => p.id === op.pageId);
            const rows = Number(op.rows); const cols = Number(op.cols);
            if (!page || rows < 1 || rows > 6 || cols < 1 || cols > 6) throw new DomainError('VALIDATION', 'Formato inválido.');
            const size = rows * cols;
            if (page.slots.slice(size).some((x) => x.kind !== 'empty')) throw new DomainError('NOT_EMPTY', 'Os bolsos que deixariam de existir não estão vazios.');
            const slots = page.slots.slice(0, size);
            while (slots.length < size) slots.push({ kind: 'empty', locked: false });
            Object.assign(page, { rows, cols, slots });
            break;
          }
          case 'arrange': {
            // moves: [{ from:{pageId,index}, to:{pageId,index} }] — reorganização planejada (prévia aprovada pelo usuário)
            const snapshot = op.moves.map((m) => ({ m, slot: findSlot(b, m.from.pageId, m.from.index).slot }));
            for (const { m, slot } of snapshot) {
              if (slot.locked) throw new DomainError('LOCKED', 'A organização automática não move bolsos bloqueados.');
              b.pages.find((p) => p.id === m.from.pageId).slots[m.from.index] = { kind: 'empty', locked: false };
            }
            for (const { m, slot } of snapshot) {
              const target = findSlot(b, m.to.pageId, m.to.index);
              if (target.slot.locked || target.slot.kind !== 'empty') throw new DomainError('CONFLICT', 'O plano de organização ficou desatualizado. Gere a prévia novamente.');
              target.page.slots[m.to.index] = { ...slot, locked: false };
              if (slot.kind === 'copy') await setCopySlot(await getCopy(slot.copyId), slotRef(b.id, m.to.pageId, m.to.index));
            }
            break;
          }
          default: throw new DomainError('VALIDATION', `Operação desconhecida: ${op.op}`);
        }
      }

      for (const c of copyCache.values()) if (c) await s.copies.put(c);
      for (const ob of otherBinders.values()) await s.binders.put({ ...ob, version: ob.version + 1, updatedAt: now() });
      const next = { ...b, version: b.version + 1, updatedAt: now() };
      await s.binders.put(next);
      if (batch.movements.length) {
        await s.batches.put(batch);
        await this._activity(s, 'binder', `${batch.movements.length} carta(s) reposicionada(s) em “${b.name}”`, { icon: 'book', batchId: batch.id, binderId: b.id });
      }
      return { binder: next, batch: batch.movements.length ? batch : null };
    });
  }

  // ---------------------------------------------------------------- decks
  async listDecks() { return (await getAll('decks')).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); }
  getDeck(id) { return get('decks', id); }

  async saveDeck(deck) {
    const name = String(deck.name || '').trim();
    if (!name) throw new DomainError('VALIDATION', 'Dê um nome ao deck.');
    for (const l of deck.cards || []) if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 60) throw new DomainError('VALIDATION', 'Quantidades devem estar entre 1 e 60.');
    return tx(['decks', 'activity'], 'readwrite', async (s) => {
      const cur = deck.id ? await s.decks.get(deck.id) : null;
      if (cur && deck.version != null && cur.version !== deck.version) throw new ConflictError();
      const next = {
        id: cur?.id || uid('dck_'), name, description: String(deck.description || '').slice(0, 600), format: deck.format || 'standard',
        cards: (deck.cards || []).map((l) => ({ cardKey: l.cardKey, cardId: l.cardId, qty: l.qty })), coverCardKey: deck.coverCardKey || null,
        visibility: deck.visibility || 'private', status: cur?.status || 'virtual', locationId: cur?.locationId || null,
        version: (cur?.version || 0) + 1, createdAt: cur?.createdAt || now(), updatedAt: now(),
      };
      await s.decks.put(next);
      if (!cur) await this._activity(s, 'deck', `Deck “${name}” criado`, { icon: 'swords', deckId: next.id });
      return next;
    });
  }

  async duplicateDeck(id) {
    const d = await this.getDeck(id);
    if (!d) throw new DomainError('NOT_FOUND', 'Deck não encontrado.');
    return this.saveDeck({ ...d, id: null, version: null, name: `${d.name} (cópia)` });
  }

  async deleteDeck(id) {
    return tx(['decks', 'copies', 'activity'], 'readwrite', async (s) => {
      const d = await s.decks.get(id);
      if (!d) throw new DomainError('NOT_FOUND', 'Deck não encontrado.');
      if (d.status === 'assembled') throw new DomainError('ASSEMBLED', 'Desmonte o deck físico antes de excluí-lo (as cartas precisam de um destino).');
      for (const c of await s.copies.getAll()) if (c.reservedFor === id) await s.copies.put({ ...c, reservedFor: null });
      await s.decks.del(id);
      await this._activity(s, 'deck', `Deck “${d.name}” excluído`, { icon: 'trash' });
      return true;
    });
  }

  /** Reserva cópias para um deck (não move nada fisicamente). Uma cópia só pode ter uma reserva. */
  async reserveCopies(deckId, copyIds) {
    return tx(['decks', 'copies', 'activity'], 'readwrite', async (s) => {
      const d = await s.decks.get(deckId);
      if (!d) throw new DomainError('NOT_FOUND', 'Deck não encontrado.');
      let n = 0;
      for (const id of copyIds) {
        const c = await s.copies.get(id);
        if (!c || c.status === 'removed') throw new DomainError('NOT_FOUND', 'Cópia não encontrada.');
        if (c.reservedFor && c.reservedFor !== deckId) throw new DomainError('RESERVED', 'Uma das cópias já está reservada para outro deck.');
        if (!d.cards.some((l) => l.cardId === c.cardId)) throw new DomainError('VALIDATION', 'Uma das cópias não corresponde a nenhuma carta da lista.');
        if (c.reservedFor !== deckId) { await s.copies.put({ ...c, reservedFor: deckId, updatedAt: now() }); n++; }
      }
      if (d.status === 'virtual') await s.decks.put({ ...d, status: 'reserved', updatedAt: now() });
      await this._activity(s, 'deck', `${n} cópia(s) reservada(s) para “${d.name}” (somente neste navegador)`, { icon: 'lock', deckId });
      return n;
    });
  }

  async releaseReservations(deckId) {
    return tx(['decks', 'copies'], 'readwrite', async (s) => {
      const d = await s.decks.get(deckId);
      if (d?.status === 'assembled') throw new DomainError('ASSEMBLED', 'Desmonte o deck antes de liberar as reservas.');
      for (const c of await s.copies.getAll()) if (c.reservedFor === deckId) await s.copies.put({ ...c, reservedFor: null });
      if (d) await s.decks.put({ ...d, status: 'virtual', updatedAt: now() });
    });
  }

  /** Montagem física: move as cópias reservadas para o local do deck (criado se preciso), em um único lote. */
  async assembleDeck(deckId, { parentLocationId = null } = {}) {
    return tx(['decks', 'copies', 'locations', 'binders', 'batches', 'activity'], 'readwrite', async (s) => {
      const d = await s.decks.get(deckId);
      if (!d) throw new DomainError('NOT_FOUND', 'Deck não encontrado.');
      const reserved = (await s.copies.getAll()).filter((c) => c.reservedFor === deckId && c.status !== 'removed');
      if (!reserved.length) throw new DomainError('NOTHING', 'Reserve as cópias antes de montar o deck.');
      let locationId = d.locationId;
      if (!locationId || !(await s.locations.get(locationId))) {
        locationId = uid('loc_');
        await s.locations.put({ id: locationId, name: `Deck box · ${d.name}`, kind: 'deck_box', parentId: parentLocationId, deckId, description: 'Local criado pela montagem física do deck.', createdAt: now() });
      }
      const batch = { id: uid('bat_'), type: 'deck', label: `Montagem do deck “${d.name}”`, createdAt: now(), movements: [] };
      const touched = new Map();
      for (const c of reserved) {
        if (c.deckAssembled && c.locationId === locationId) continue;
        if (c.slot) await this._clearSlotForCopy(s, c, touched);
        batch.movements.push({ id: uid('mv_'), copyId: c.id, cardKey: c.cardKey, from: { locationId: c.locationId, slot: c.slot }, to: { locationId, slot: null } });
        await s.copies.put({ ...c, locationId, slot: null, deckAssembled: true, updatedAt: now() });
      }
      for (const b of touched.values()) await s.binders.put({ ...b, version: b.version + 1, updatedAt: now() });
      await s.decks.put({ ...d, status: 'assembled', locationId, updatedAt: now() });
      if (batch.movements.length) await s.batches.put(batch);
      await this._activity(s, 'deck', `Deck “${d.name}” montado com ${reserved.length} carta(s)`, { icon: 'swords', deckId, batchId: batch.id });
      return batch;
    });
  }

  async disassembleDeck(deckId, toLocationId = SYS_INBOX) {
    return tx(['decks', 'copies', 'locations', 'batches', 'activity'], 'readwrite', async (s) => {
      const d = await s.decks.get(deckId);
      if (!d) throw new DomainError('NOT_FOUND', 'Deck não encontrado.');
      const dest = await s.locations.get(toLocationId);
      if (!dest || dest.deckId || dest.binderId || dest.id === SYS_REMOVED) throw new DomainError('VALIDATION', 'Escolha um destino válido para as cartas.');
      const batch = { id: uid('bat_'), type: 'deck', label: `Desmontagem do deck “${d.name}”`, createdAt: now(), movements: [] };
      for (const c of await s.copies.getAll()) {
        if (c.reservedFor !== deckId) continue;
        if (c.deckAssembled) batch.movements.push({ id: uid('mv_'), copyId: c.id, cardKey: c.cardKey, from: { locationId: c.locationId, slot: null }, to: { locationId: dest.id, slot: null } });
        await s.copies.put({ ...c, locationId: c.deckAssembled ? dest.id : c.locationId, deckAssembled: false, reservedFor: null, updatedAt: now() });
      }
      if (d.locationId) await s.locations.del(d.locationId);
      await s.decks.put({ ...d, status: 'virtual', locationId: null, updatedAt: now() });
      if (batch.movements.length) await s.batches.put(batch);
      await this._activity(s, 'deck', `Deck “${d.name}” desmontado`, { icon: 'swords', deckId, batchId: batch.id });
      return batch;
    });
  }

  // ---------------------------------------------------------------- wishlist
  async listWishlist() { return (await getAll('wishlist')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
  async addWishlist({ cardKey, cardId, qty = 1, priority = 'normal', note = '' }) {
    return tx(['wishlist', 'activity'], 'readwrite', async (s) => {
      const all = await s.wishlist.getAll();
      const existing = all.find((w) => w.cardId === cardId);
      if (existing) {
        const next = { ...existing, qty: Math.max(existing.qty, qty), updatedAt: now() };
        await s.wishlist.put(next);
        return next;
      }
      const item = { id: uid('wsh_'), cardKey, cardId, qty: Math.max(1, Math.min(99, qty)), priority, note, createdAt: now(), updatedAt: now() };
      await s.wishlist.put(item);
      await this._activity(s, 'wishlist', 'Carta adicionada à Wishlist', { icon: 'heart', cardKey });
      return item;
    });
  }
  async updateWishlist(id, patch) {
    return tx('wishlist', 'readwrite', async (s) => {
      const w = await s.wishlist.get(id);
      if (!w) throw new DomainError('NOT_FOUND', 'Item não encontrado.');
      const next = { ...w, ...patch, qty: patch.qty != null ? Math.max(1, Math.min(99, Number(patch.qty))) : w.qty, updatedAt: now() };
      await s.wishlist.put(next);
      return next;
    });
  }
  removeWishlist(id) { return tx('wishlist', 'readwrite', (s) => s.wishlist.del(id)); }

  // ---------------------------------------------------------------- imagens (originais preservados)
  async listAssets() {
    const all = await getAll('assets');
    return all.map(({ blob, ...meta }) => meta).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async addAsset({ blob, name, width, height, mime }) {
    const asset = { id: uid('ast_'), name: String(name || 'imagem').slice(0, 120), width, height, mime, size: blob.size, blob, createdAt: now() };
    await tx(['assets', 'activity'], 'readwrite', async (s) => {
      await s.assets.put(asset);
      await this._activity(s, 'asset', `Imagem “${asset.name}” enviada para a biblioteca`, { icon: 'image' });
    });
    const { blob: _b, ...meta } = asset;
    return meta;
  }
  async getAssetBlob(id) { return (await get('assets', id))?.blob || null; }
  async assetUsage(id) {
    const binders = await getAll('binders');
    const uses = [];
    for (const b of binders) {
      if (b.appearance?.coverAssetId === id) uses.push({ binder: b, where: 'capa' });
      b.pages.forEach((p, pi) => p.slots.forEach((s, si) => { if (s.assetId === id) uses.push({ binder: b, where: `pág. ${pi + 1}, bolso ${si + 1}` }); }));
    }
    return uses;
  }
  async deleteAsset(id) {
    const uses = await this.assetUsage(id);
    if (uses.length) throw new DomainError('IN_USE', `Imagem em uso (${uses.length} lugar(es)). Remova-a dos fichários antes de excluir.`);
    await tx('assets', 'readwrite', (s) => s.assets.del(id));
  }

  // ---------------------------------------------------------------- exportação
  async exportAll() {
    const [cards, copies, locations, binders, decks, wishlist, batches, assets, activity] = await Promise.all(
      ['cards', 'copies', 'locations', 'binders', 'decks', 'wishlist', 'batches', 'assets', 'activity'].map((n) => getAll(n)));
    return {
      format: 'duskdex-browser-export', version: 1, exportedAt: now(),
      note: 'Exportação do uso sem conta (este navegador). Imagens enviadas não são incluídas (apenas metadados).',
      profile: await this.getProfile(), cards, copies, locations, binders, decks, wishlist, batches, activity,
      assets: assets.map(({ blob, ...m }) => m),
    };
  }
}
