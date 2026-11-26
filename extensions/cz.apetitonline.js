/// <reference path="../types/dishko-extension.d.ts" />
"use strict";

// Apetit (apetitonline.cz) – redakční recepty časopisu Apetit.
// Výpis: /recepty?page=N nebo /kategorie/<slug>?page=N (Drupal, stránky číslované od 0),
// detail: Schema.org Recipe JSON-LD + skupiny surovin z HTML.
// Pozn.: vyhledávání (/vyhledavani) je za Cloudflare ochranou, která blokuje ne-prohlížečové
// klienty, proto rozšíření hledání nenabízí (capability "search" není deklarována).

const BASE_URL = "https://www.apetitonline.cz";

const CATEGORIES = [
  ["", "Vše (nejnovější)"],
  ["polevky", "Polévky"],
  ["kureci-maso", "Kuřecí"],
  ["veprove-maso", "Vepřové"],
  ["hovezi-maso", "Hovězí"],
  ["mlete-maso", "Mleté maso"],
  ["kachna-husa", "Kachna a husa"],
  ["zverina", "Zvěřina"],
  ["ryby", "Ryby"],
  ["morske-plody", "Mořské plody"],
  ["bezmasa-jidla", "Bezmasá jídla"],
  ["zeleninova-jidla", "Zeleninová jídla"],
  ["bramborova-jidla", "Bramborová jídla"],
  ["lusteniny", "Luštěniny"],
  ["testoviny-gnocchi", "Těstoviny a gnocchi"],
  ["rizota", "Rizota"],
  ["vajecna-jidla", "Vaječná jídla"],
  ["houby", "Houby"],
  ["prilohy", "Přílohy"],
  ["salaty", "Saláty"],
  ["predkrmy", "Předkrmy"],
  ["pomazanky", "Pomazánky"],
  ["slane-pohosteni", "Slané pohoštění"],
  ["omacky-dipy", "Omáčky a dipy"],
  ["pecivo", "Pečivo"],
  ["pizza-slane-kolace", "Pizza a slané koláče"],
  ["sladka-jidla", "Sladká jídla"],
  ["dezerty-moucniky", "Dezerty a moučníky"],
  ["kolace-buchty", "Koláče a buchty"],
  ["dorty", "Dorty"],
  ["cukrovi", "Cukroví"],
  ["grilovani", "Grilování"],
  ["napoje", "Nápoje"],
  ["nakladani-zavarovani", "Nakládání a zavařování"],
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

function cleanTitle(t) {
  return String(t || "")
    .replace(/\s*[-–|]\s*recept\s*$/i, "")
    .trim();
}

function parseListing(html) {
  const doc = dishko.html.parse(html);
  const seen = new Set();
  const items = [];
  doc.select(".view-content.recipes a.recipe, .view-content.nodes-list a.recipe").forEach(a => {
    const url = absoluteUrl(a.attr("href"));
    if (!url || url.indexOf("/recept/") < 0 || seen.has(url)) return;
    const titleNode = a.selectOne(".recipe__title");
    const title = cleanTitle(titleNode ? titleNode.text() : a.attr("title"));
    if (!title) return;
    seen.add(url);
    const img = a.selectOne("img");
    const time = a.selectOne(".ico--time + span");
    items.push({
      id: url.replace(BASE_URL, ""),
      title: title,
      imageUrl: img ? absoluteUrl(img.attr("data-src") || img.attr("src")) : null,
      summary: time ? time.text() : null,
      sourceUrl: url,
    });
  });
  const next = doc.selectOne(".e-pager__item--next a[href]");
  return { items: items, hasNextPage: items.length > 0 && next !== null };
}

function formatAmount(text) {
  // "2.00" -> "2", "0.50" -> "0.5"
  return String(text || "").replace(/(\d+)\.(\d+)/g, (m, a, b) => {
    const dec = b.replace(/0+$/, "");
    return dec ? a + "." + dec : a;
  });
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
    const cat = filters && filters.category;
    const path = cat ? "/kategorie/" + encodeURIComponent(cat) : "/recepty";
    const url = BASE_URL + path + (page > 1 ? "?page=" + (page - 1) : "");
    return parseListing(get(url).body);
  },

  getRecipeDetail(id) {
    const url = /^https?:\/\//i.test(id) ? id : absoluteUrl(id);
    const res = get(url);
    const html = res.body;
    const doc = dishko.html.parse(html);
    let recipe = dishko.jsonLd.extractRecipe(html, res.url);
    if (!recipe) {
      const h1 = doc.selectOne("h1");
      const og = doc.selectOne("meta[property='og:image']");
      recipe = {
        title: h1 ? h1.text() : "",
        ingredients: [],
        steps: [],
        imageUrls: og ? [absoluteUrl(og.attr("content"))].filter(Boolean) : [],
      };
    }
    recipe.title = cleanTitle(recipe.title);
    recipe.sourceUrl = res.url || url;

    // Suroviny po skupinách ("K podávání", "Na těsto" ...) z HTML receptové karty.
    const grouped = [];
    let group = null;
    doc.select("h3.recipe-card__subtitle, li.recipe-card__ingredient").forEach(node => {
      if (node.attr("class") && node.attr("class").indexOf("recipe-card__subtitle") >= 0) {
        group = node.text().replace(/:\s*$/, "").trim() || null;
        return;
      }
      const textNode = node.selectOne(".checkbox__text") || node;
      const raw = formatAmount(textNode.text()).replace(/\s+,/g, ",").trim();
      if (raw) grouped.push({ rawText: raw, groupName: group });
    });
    if (grouped.length > 0) recipe.ingredients = grouped;

    if (!recipe.steps || recipe.steps.length === 0) {
      recipe.steps = doc.select(".recipe-card__steps li, .recipe-steps li").map(li => li.text());
    }
    recipe.steps = (recipe.steps || [])
      .map(s => String(s).replace(/^\s*\d+\s*[.)]\s*/, "").trim())
      .filter(Boolean);

    if (recipe.servingsLabel && /osob/i.test(recipe.servingsLabel)) recipe.servingsLabel = "porce";
    return recipe;
  },
});
