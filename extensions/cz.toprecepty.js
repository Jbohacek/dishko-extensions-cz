/// <reference path="../types/dishko-extension.d.ts" />
"use strict";

// TopRecepty.cz – velká komunitní databáze receptů a videoreceptů.
// Výpis: /vsechny_recepty.php?stranka=N (nejnovější) nebo /kategorie/<id-slug>/<N>/,
// hledání: /vyhledavani-receptu?term=<dotaz>&page=N, detail: Schema.org Recipe JSON-LD.

const BASE_URL = "https://www.toprecepty.cz";

const CATEGORIES = [
  ["", "Vše (nejnovější)"],
  ["1-veprove-maso", "Vepřové maso"],
  ["2-hovezi-maso", "Hovězí maso"],
  ["6-drubezi-maso", "Drůbeží maso"],
  ["5-mlete-maso", "Mleté maso"],
  ["3-jine-maso", "Jiné maso"],
  ["12-ryby", "Ryby"],
  ["21-bezmasa-jidla", "Bezmasá jídla"],
  ["19-bramborova-jidla", "Bramborová jídla"],
  ["20-zeleninova-jidla", "Zeleninová jídla"],
  ["18-lusteniny", "Luštěniny"],
  ["17-testoviny", "Těstoviny"],
  ["31-minutky", "Minutky"],
  ["16-polevky", "Polévky"],
  ["25-omacky", "Omáčky"],
  ["26-prilohy", "Přílohy"],
  ["24-salaty", "Saláty"],
  ["15-predkrmy", "Předkrmy"],
  ["11-pomazanky", "Pomazánky"],
  ["39-slane-pecivo", "Slané pečivo"],
  ["4-sladka-jidla", "Sladká jídla"],
  ["27-moucniky", "Moučníky"],
  ["43-dorty", "Dorty"],
  ["35-cukrovi", "Cukroví"],
  ["13-napoje", "Nápoje"],
  ["33-zavareniny", "Zavařeniny"],
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

function parseListing(html) {
  const doc = dishko.html.parse(html);
  const seen = new Set();
  const items = [];
  doc.select("article.b-recipe").forEach(card => {
    const link = card.selectOne("a.b-recipe__link[href^='/recept/'], .b-recipe__title a");
    if (!link) return;
    const url = absoluteUrl(link.attr("href"));
    const title = link.text();
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const img = card.selectOne("img.img__img") || card.selectOne("img");
    const time = card.selectOne(".b-recipe__time");
    const author = card.selectOne(".b-recipe__info a[href^='/profil/']");
    const summary = [time ? time.text() : null, author ? author.text() : null].filter(Boolean).join(" · ");
    items.push({
      id: url.replace(BASE_URL, ""),
      title: title,
      imageUrl: img ? absoluteUrl(img.attr("data-src") || img.attr("src")) : null,
      summary: summary || null,
      sourceUrl: url,
    });
  });
  return { items: items, hasNextPage: items.length > 0 && doc.selectOne("a.paging__next[href]") !== null };
}

// Suroviny typu "Na zahuštění:" jsou v JSON-LD jen nadpisy skupin -> převést na groupName.
function regroupIngredients(list) {
  const out = [];
  let group = null;
  (list || []).forEach(i => {
    const raw = (i.rawText || i.name || "").trim();
    if (!raw) return;
    if (/:\s*$/.test(raw) && !/\d/.test(raw) && raw.length <= 60) {
      group = raw.replace(/:\s*$/, "").trim() || null;
      return;
    }
    out.push(Object.assign({}, i, { rawText: i.rawText ? raw : i.rawText, groupName: i.groupName || group }));
  });
  return out;
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
    const url = cat
      ? BASE_URL + "/kategorie/" + encodeURIComponent(cat) + "/" + (page > 1 ? page + "/" : "")
      : BASE_URL + "/vsechny_recepty.php" + (page > 1 ? "?stranka=" + page : "");
    return parseListing(get(url).body);
  },

  search(query, page, filters) {
    const q = String(query || "").trim();
    if (!q) return { items: [], hasNextPage: false };
    const url = BASE_URL + "/vyhledavani-receptu?term=" + encodeURIComponent(q) + (page > 1 ? "&page=" + page : "");
    const res = dishko.http.get(url);
    if (res.status === 404) return { items: [], hasNextPage: false };
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parseListing(res.body);
  },

  getRecipeDetail(id) {
    const url = /^https?:\/\//i.test(id) ? id : absoluteUrl(id);
    const res = get(url);
    const html = res.body;
    let recipe = dishko.jsonLd.extractRecipe(html, res.url);

    if (!recipe || !recipe.title) {
      // Záložní parsování HTML (pro případ, že by JSON-LD chybělo).
      const doc = dishko.html.parse(html);
      const h1 = doc.selectOne("h1");
      const og = doc.selectOne("meta[property='og:image']");
      recipe = {
        title: h1 ? h1.text() : "",
        imageUrls: og ? [absoluteUrl(og.attr("content"))].filter(Boolean) : [],
        ingredients: doc.select("[itemprop='recipeIngredient'], .b-ingredients li").map(li => ({ rawText: li.text() })),
        steps: doc.select("[itemprop='recipeInstructions'] li, .b-steps li").map(li => li.text()),
      };
    }

    recipe.sourceUrl = res.url || url;
    recipe.ingredients = regroupIngredients(recipe.ingredients);
    recipe.steps = (recipe.steps || [])
      .map(s => String(s).replace(/^\s*\d+\s*[.)]\s*/, "").trim())
      .filter(Boolean);
    if (!recipe.servingsLabel) recipe.servingsLabel = "porce";
    return recipe;
  },
});
