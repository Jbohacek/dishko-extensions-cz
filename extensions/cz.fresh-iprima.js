/// <reference path="../types/dishko-extension.d.ts" />
"use strict";

// Prima Fresh (fresh.iprima.cz) – recepty a videorecepty TV Prima.
// Výpis + hledání: stránkovatelné HTML snippety (/_snippet/category/{limit}/{offset}/{id},
// /_snippet/search-content/{limit}/{offset}/{dotaz}); detail: Schema.org Recipe JSON-LD
// + doplnění porcí a skupin surovin z HTML.

const BASE_URL = "https://fresh.iprima.cz";

const PAGE_SIZE = 18;

// [slug, název, interní ID kategorie pro /_snippet/category]
const CATEGORIES = [
  ["", "Vše", 1949],
  ["hlavni-jidla", "Hlavní jídla", 2023],
  ["maso", "Maso", 1973],
  ["ryby-morske-plody", "Ryby a mořské plody", 1969],
  ["vegetarianske", "Vegetariánské", 1977],
  ["polevky", "Polévky", 1972],
  ["salaty", "Saláty", 1970],
  ["testoviny", "Těstoviny", 1966],
  ["prilohy", "Přílohy", 1978],
  ["zelenina", "Zelenina", 1974],
  ["predkrmy-chutovky", "Předkrmy a chuťovky", 1976],
  ["snidane", "Snídaně", 2003],
  ["sladke", "Sladké", 1975],
  ["cukrovi", "Cukroví", 2054],
  ["pecivo", "Pečivo", 1999],
  ["ovoce", "Ovoce", 1979],
  ["napoje", "Nápoje", 1967],
];

function absoluteUrl(href) {
  if (!href) return null;
  href = String(href).trim();
  if (!href || /^data:/i.test(href)) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return "https:" + href;
  return href.startsWith("/") ? BASE_URL + href : BASE_URL + "/" + href;
}

function htmlToText(html) {
  if (!html) return "";
  return dishko.html.parse("<div>" + html + "</div>").text();
}

function cleanStep(text) {
  return String(text || "")
    .replace(/^\s*\d+\s*[.)]\s*/, "")
    .trim();
}

function get(url) {
  const res = dishko.http.get(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " (" + url + ")");
  return res;
}

function parseCards(doc, selector) {
  const seen = new Set();
  const items = [];
  doc.select(selector).forEach(card => {
    const link = card.selectOne(".article-title a") || card.selectOne("h3 a") || card.selectOne("a[href]");
    const href = link ? link.attr("href") : null;
    const url = absoluteUrl(href);
    // Magazínové články (/magazin/...) nejsou recepty – vynechat.
    if (!url || seen.has(url) || /\/magazin\//.test(url)) return;
    const title = link.text();
    if (!title) return;
    seen.add(url);
    const img = card.selectOne("img");
    const tag = card.selectOne(".tag");
    items.push({
      id: url.replace(BASE_URL, ""),
      title: title,
      imageUrl: img ? absoluteUrl(img.attr("data-src") || img.attr("src")) : null,
      summary: tag ? tag.text() : null,
      sourceUrl: url,
    });
  });
  return items;
}

function snippetPage(path, page) {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const res = dishko.http.get(BASE_URL + "/_snippet/" + path.replace("{limit}", PAGE_SIZE).replace("{offset}", offset));
  if (res.status === 404) return { items: [], hasNextPage: false };
  if (!res.ok) throw new Error("HTTP " + res.status);
  const doc = dishko.html.parse("<div>" + res.body + "</div>");
  const items = parseCards(doc, "article");
  // Další stránka existuje, pokud web vrátil plnou dávku (před odfiltrováním magazínových článků).
  return { items: items, hasNextPage: doc.select("article").length >= PAGE_SIZE };
}

defineSource({
  getFilters() {
    return [
      {
        id: "category",
        label: "Kategorie",
        options: CATEGORIES.map(c => ({ value: c[0], label: c[1] })),
      },
    ];
  },

  getPopular(page, filters) {
    const slug = (filters && filters.category) || "";
    const cat = CATEGORIES.find(c => c[0] === slug) || CATEGORIES[0];
    return snippetPage("category/{limit}/{offset}/" + cat[2], page);
  },

  search(query, page, filters) {
    const q = String(query || "").trim();
    if (!q) return { items: [], hasNextPage: false };
    // Web očekává dotaz dvakrát URL-enkódovaný (viz data-next-link na stránce /vyhledat).
    return snippetPage("search-content/{limit}/{offset}/" + encodeURIComponent(encodeURIComponent(q)), page);
  },

  getRecipeDetail(id) {
    const url = /^https?:\/\//i.test(id) ? id : absoluteUrl(id);
    const res = get(url);
    const html = res.body;
    const doc = dishko.html.parse(html);
    const recipe = dishko.jsonLd.extractRecipe(html, res.url) || {
      title: "",
      ingredients: [],
      steps: [],
      imageUrls: [],
    };

    if (!recipe.title) {
      const h1 = doc.selectOne("h1");
      recipe.title = h1 ? h1.text() : "";
    }
    recipe.sourceUrl = res.url || url;

    // Porce + čas z "recipe-main-points-molecule" (JSON-LD nemá recipeYield).
    doc.select(".recipe-main-points-molecule .main-point").forEach(p => {
      const t = p.text();
      const portions = t.match(/(\d+)\s*(porc|osob|ks|kus)/i);
      if (portions && !recipe.servings) {
        recipe.servings = parseInt(portions[1], 10);
        recipe.servingsLabel = /ks|kus/i.test(portions[2]) ? "ks" : "porce";
      }
      const mins = t.match(/(\d+)\s*min/i);
      const hours = t.match(/(\d+)\s*hod/i);
      if ((mins || hours) && !recipe.cookTimeMinutes && !recipe.prepTimeMinutes) {
        recipe.cookTimeMinutes = (hours ? parseInt(hours[1], 10) * 60 : 0) + (mins ? parseInt(mins[1], 10) : 0);
      }
    });

    // Suroviny po skupinách z HTML (JSON-LD je plochý seznam).
    const boxes = doc.select(".ingredients-box");
    const grouped = [];
    boxes.forEach(box => {
      const heading = box.selectOne("h3, h4");
      let group = heading ? heading.text().replace(/:\s*$/, "").trim() : null;
      if (boxes.length === 1 || /^suroviny$/i.test(group || "")) group = null;
      box.select("li").forEach(li => {
        const amountNode = li.selectOne("b, strong");
        const amount = amountNode ? amountNode.text() : "";
        const nameNode = li.selectOne("a");
        let full = li.text();
        let name = nameNode ? nameNode.text() : full.replace(amount, "");
        const noteMatch = full.match(/\(([^)]*)\)/);
        const note = noteMatch ? noteMatch[1].trim() : "";
        if (!nameNode) name = name.replace(/\([^)]*\)/g, "");
        name = name.replace(/\s+/g, " ").trim();
        if (!name) return;
        const raw = [amount, name].filter(Boolean).join(" ") + (note ? ", " + note : "");
        grouped.push({ rawText: raw, groupName: group });
      });
    });
    if (grouped.length > 0) recipe.ingredients = grouped;

    recipe.steps = (recipe.steps || []).map(s => cleanStep(htmlToText(s))).filter(Boolean);
    if (recipe.steps.length === 0) {
      recipe.steps = doc
        .select("h2 + ol li")
        .map(li => cleanStep(li.text()))
        .filter(Boolean);
    }

    if (recipe.notes) recipe.notes = htmlToText(recipe.notes);

    // Hlavní kategorie receptu (první štítek v hlavičce) + klíčová slova z JSON-LD.
    const primaryTag = doc.selectOne(".left-side .tag");
    const tags = [primaryTag ? primaryTag.text() : null]
      .concat(recipe.suggestedTags || [])
      .filter(t => t && !/^recepty$/i.test(t));
    recipe.suggestedTags = Array.from(new Set(tags));

    // Videorecepty mají jen seznam surovin bez množství a postup pouze ve videu.
    if (recipe.steps.length === 0 && /\/videorecepty\//.test(recipe.sourceUrl)) {
      recipe.notes = "Videorecept – postup přípravy najdete ve videu na " + recipe.sourceUrl;
    }

    if (!recipe.imageUrls || recipe.imageUrls.length === 0) {
      const og = doc.selectOne("meta[property='og:image']");
      recipe.imageUrls = og ? [absoluteUrl(og.attr("content"))].filter(Boolean) : [];
    }
    return recipe;
  },
});
