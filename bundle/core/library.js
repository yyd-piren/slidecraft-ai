/**
 * 本地资产库：AI 生成的主题沉淀 + 已完成的 PPT 归档。
 *
 * 数据全部存 anna.storage（宿主 APS / harness legacy），不依赖任何服务端。
 * - 主题库  ：slidecraft.themes          → Theme JSON 数组（最多 12 个）
 * - 归档索引：slidecraft.deckIndex       → 摘要数组（最多 6 条）
 * - 归档正文：slidecraft.deck.<deckId>   → 完整 Deck（独立 key，避免单条 value 过大）
 */
import { uid, normalizeTheme, copy } from './deck.js';

const THEMES_KEY = 'slidecraft.themes';
const INDEX_KEY = 'slidecraft.deckIndex';
const deckKey = (id) => `slidecraft.deck.${id}`;
const MAX_THEMES = 12;
const MAX_DECKS = 6;

export function createLibrary(storage) {
  let themes = null;
  let index = null;

  async function loadThemes() {
    if (!themes) {
      const v = await safeGet(THEMES_KEY);
      themes = Array.isArray(v) ? v.filter((t) => t && t.id).slice(0, MAX_THEMES) : [];
    }
    return themes;
  }
  async function loadIndex() {
    if (!index) {
      const v = await safeGet(INDEX_KEY);
      index = Array.isArray(v) ? v.filter((d) => d && d.id).slice(0, MAX_DECKS) : [];
    }
    return index;
  }
  async function safeGet(key) {
    try { return await storage.getJSON(key); } catch { return null; }
  }
  async function safeSet(key, value) {
    try { await storage.setJSON(key, value); return true; } catch { return false; }
  }

  return {
    // ---------- 主题库 ----------
    async listThemes() { return copy(await loadThemes()); },

    /**
     * 沉淀一个主题并返回带稳定 id 的副本。
     * 相同名称 + 相同配色的重复提交会被更新而非无限追加。
     */
    async saveTheme(input) {
      const t = normalizeTheme(input);
      const list = await loadThemes();
      const fingerprint = [t.background, t.primaryColor, t.accentColor, t.titleColor, t.fontFamily, t.name].join('|');
      const same = list.find((x) => [x.background, x.primaryColor, x.accentColor, x.titleColor, x.fontFamily, x.name].join('|') === fingerprint);
      const saved = { ...t, id: same?.id || `custom_${uid('th').slice(-8)}`, savedAt: Date.now() };
      themes = [saved, ...list.filter((x) => x.id !== saved.id)].slice(0, MAX_THEMES);
      await safeSet(THEMES_KEY, themes);
      return copy(saved);
    },

    async removeTheme(id) {
      themes = (await loadThemes()).filter((t) => t.id !== id);
      await safeSet(THEMES_KEY, themes);
    },

    // ---------- PPT 归档 ----------
    async listDecks() { return copy(await loadIndex()); },

    async saveDeck(deck) {
      if (!deck || !deck.id) return null;
      const theme = normalizeTheme(deck.theme);
      const entry = {
        id: deck.id,
        title: String(deck.meta?.topic || deck.slides?.[0]?.title || '未命名演示'),
        pages: Array.isArray(deck.slides) ? deck.slides.length : 0,
        themeName: theme.name || '自定义',
        at: Date.now(),
      };
      const list = await loadIndex();
      index = [entry, ...list.filter((d) => d.id !== deck.id)].slice(0, MAX_DECKS);
      await safeSet(INDEX_KEY, index);
      await safeSet(deckKey(deck.id), deck);
      // 淘汰超出上限的旧正文，避免长期占用宿主存储。
      for (const old of list.slice(MAX_DECKS - 1)) {
        if (!index.some((d) => d.id === old.id)) await safeSet(deckKey(old.id), null);
      }
      return entry;
    },

    async loadDeck(id) {
      const v = await safeGet(deckKey(id));
      return v && typeof v === 'object' ? v : null;
    },

    async removeDeck(id) {
      index = (await loadIndex()).filter((d) => d.id !== id);
      await safeSet(INDEX_KEY, index);
      await safeSet(deckKey(id), null);
    },
  };
}
