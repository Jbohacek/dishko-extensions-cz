/// <reference path="../types/dishko-extension.d.ts" />
"use strict";

// Miluji vaření (milujivareni.cz) – obří komunitní databáze receptů.
// Web je Next.js: výpis i hledání čteme z vloženého JSON (__NEXT_DATA__),
// detail ze Schema.org Recipe JSON-LD.
//  - výpis:    /top-recepty[/<kategorie>]?sort=<řazení>&page=N  (10 receptů/stránka)
//  - hledání:  /vyhledavani?s=<dvakrát URL-enkódovaný dotaz>&page=N
//  - detail:   /recepty/<slug>

const BASE_URL = "https://www.milujivareni.cz";
const IMAGE_BASE = "https://admin.milujivareni.cz/";
const PAGE_SIZE = 10;

const CATEGORIES = [
  ["", "Vše"],
  ["chod/hlavni-chod", "Hlavní chod"],
  ["chod/hlavni-chod/chod-maso", "Hlavní chod – maso"],
  ["chod/hlavni-chod/brambory", "Hlavní chod – brambory"],
  ["chod/hlavni-chod/testoviny-nocky", "Těstoviny, noky, knedlíky"],
  ["chod/polevky", "Polévky"],
  ["chod/predkrmy", "Předkrmy"],
  ["chod/salaty", "Saláty"],
  ["chod/priloha", "Přílohy"],
  ["chod/dezerty-kolace", "Dezerty a moučníky"],
  ["chod/dezerty-kolace/cukrovi", "Cukroví"],
  ["chod/dezerty-kolace/kolace", "Koláče"],
  ["chod/dezerty-kolace/dorty", "Dorty"],
  ["chod/ostatni/pomazanky", "Pomazánky"],
  ["chod/napoje", "Nápoje"],
  ["hlavni-ingredience/maso/veprove", "Vepřové maso"],
  ["hlavni-ingredience/maso", "Maso (vše)"],
  ["hlavni-ingredience/ryby", "Ryby"],
  ["hlavni-ingredience/lusteniny", "Luštěniny"],
  ["hlavni-ingredience/houby", "Houby"],
  ["hlavni-ingredience/zelenina", "Zelenina"],
  ["specialni/vegetarianske", "Vegetariánské"],
  ["specialni/veganske", "Veganské"],
  ["specialni/pro-deti", "Pro děti"],
  ["prilezitost/snidane", "Snídaně"],
  ["prilezitost/vecere", "Večeře"],
];

const SORTS = [
  ["", "Výchozí (oblíbené)"],
  ["newest", "Nejnovější"],
  ["top", "Nejlépe hodnocené"],
  ["easy", "Jednoduché"],
  ["video", "S videem"],
  ["healthy", "Pro zdraví"],
];

function absoluteUrl(href) {
  if (!href) return null;
  href = String(href).trim();
  if (!href || /^data:/i.test(href)) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return "https:" + href;
  return href.startsWith("/") ? BASE_URL + href : BASE_URL + "/" + href;
}

function get(url) {
  const res = dishko.http.get(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " (" + url + ")");
  return res;
}

// Vyřízne hodnotu klíče "<key>":[ ... ] z __NEXT_DATA__ bez parsování celého (až ~2 MB) JSONu.
function extractArray(body, key, nextKey) {
  const start = body.indexOf('"' + key + '":[');
  if (start < 0) return null;
  const from = start + key.length + 3; // index znaku "["
  const end = nextKey ? body.indexOf(',"' + nextKey + '":', from) : -1;
  if (end < 0) {
    // Záložní cesta: parsovat celé __NEXT_DATA__.
    const m = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const props = JSON.parse(m[1]).props.pageProps || {};
    return props[key] || null;
  }
  return JSON.parse(body.substring(from, end));
}

function totalCount(body) {
  const m = body.match(/"totalCount":(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function toCard(r) {
  if (!r || !r.url || !r.name) return null;
  const url = BASE_URL + "/recepty/" + r.url;
  const time = (r.preparationTime || 0) + (r.cookingTime || 0);
  const summary = [time > 0 ? time + " min" : null, r.servings ? r.servings + " porce" : null]
    .filter(Boolean)
    .join(" · ");
  return {
    id: r.url,
    title: String(r.name).trim(),
    imageUrl: r.image && r.image.path ? IMAGE_BASE + r.image.path : null,
    summary: summary || null,
    sourceUrl: url,
  };
}

function toResult(list, body, page) {
  const seen = new Set();
  const items = (list || [])
    .map(toCard)
    .filter(c => c && !seen.has(c.id) && seen.add(c.id));
  const total = totalCount(body);
  return { items: items, hasNextPage: items.length > 0 && page * PAGE_SIZE < total };
}

function listingUrl(category, sort, page) {
  const params = [];
  if (sort) params.push("sort=" + encodeURIComponent(sort));
  if (page > 1) params.push("page=" + page);
  const path = category
    ? "/" + category.split("/").map(encodeURIComponent).join("/")
    : "";
  return BASE_URL + "/top-recepty" + path + (params.length ? "?" + params.join("&") : "");
}

defineSource({
  getFilters() {
    return [
      { id: "category", label: "Kategorie", options: CATEGORIES.map(c => ({ value: c[0], label: c[1] })) },
      { id: "sort", label: "Řazení", options: SORTS.map(s => ({ value: s[0], label: s[1] })) },
    ];
  },

  getPopular(page, filters) {
    const category = (filters && filters.category) || "";
    const sort = (filters && filters.sort) || "";
    const body = get(listingUrl(category, sort, page)).body;
    return toResult(extractArray(body, "recipes", "recipeCategories"), body, page);
  },

  search(query, page, filters) {
    const q = String(query || "").trim();
    if (!q) return { items: [], hasNextPage: false };
    // Web posílá dotaz dvakrát enkódovaný (encodeURIComponent + Next.js router).
    const url = BASE_URL + "/vyhledavani?s=" + encodeURIComponent(encodeURIComponent(q)) + (page > 1 ? "&page=" + page : "");
    const res = dishko.http.get(url);
    if (res.status === 404) return { items: [], hasNextPage: false };
    if (!res.ok) throw new Error("HTTP " + res.status);
    return toResult(extractArray(res.body, "resultList", null), res.body, page);
  },

  getRecipeDetail(id) {
    let url;
    if (/^https?:\/\//i.test(id)) url = id;
    else if (String(id).indexOf("/") >= 0) url = absoluteUrl(id);
    else url = BASE_URL + "/recepty/" + encodeURIComponent(id);

    const res = get(url);
    const html = res.body;
    let recipe = dishko.jsonLd.extractRecipe(html, res.url);
    if (!recipe || !recipe.title) {
      const doc = dishko.html.parse(html);
      const h1 = doc.selectOne("h1");
      recipe = { title: h1 ? h1.text() : "", ingredients: [], steps: [], imageUrls: [] };
    }

    recipe.sourceUrl = res.url || url;
    recipe.servingsLabel = recipe.servingsLabel || "porce";
    recipe.steps = (recipe.steps || [])
      .map(s => String(s).replace(/^\s*\d+\s*[.)]\s*/, "").trim())
      .filter(Boolean);

    // Web dává do "description" celý postup – v poznámkách by se jen duplikoval.
    if (recipe.notes) {
      const norm = s => String(s).replace(/\s+/g, " ").trim();
      if (norm(recipe.notes) === norm(recipe.steps.join(" ")) || recipe.steps.some(s => norm(recipe.notes).indexOf(norm(s)) === 0)) {
        recipe.notes = null;
      }
    }

    // Skupiny surovin (např. "Těsto", "Náplň") jsou jen v __NEXT_DATA__, JSON-LD je plochý.
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const detail = m ? (JSON.parse(m[1]).props.pageProps || {}).recipeDetail : null;
    const groups = detail && Array.isArray(detail.recipeIngredientGroups) ? detail.recipeIngredientGroups : [];
    const grouped = [];
    groups.forEach(g => {
      const groupName = g && g.name ? String(g.name).replace(/:\s*$/, "").trim() || null : null;
      (g && g.ingredients ? g.ingredients : []).forEach(i => {
        if (!i || !i.ingredient) return;
        const amount = i.amount !== null && i.amount !== undefined && i.amount !== 0 ? String(i.amount) : "";
        const raw = [amount, amount ? i.unit || "" : "", String(i.ingredient).trim()].filter(Boolean).join(" ");
        grouped.push({ rawText: raw, groupName: groupName });
      });
    });
    if (grouped.length > 0) recipe.ingredients = grouped;
    if (!recipe.servings && detail && detail.servings) recipe.servings = detail.servings;
    if (detail && detail.note && String(detail.note).trim()) recipe.notes = String(detail.note).trim();

    // Web nemá štítky receptu – názvy surovin pomohou Dishku navrhnout ProteinTag.
    if (!recipe.suggestedTags || recipe.suggestedTags.length === 0) {
      recipe.suggestedTags = Array.from(
        new Set(recipe.ingredients.map(i => String(i.rawText || "").replace(/^[\d.,\s]+\S*\s+/, "").toLowerCase()).filter(Boolean))
      ).slice(0, 15);
    }
    return recipe;
  },
});
