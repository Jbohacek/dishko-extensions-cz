/// <reference path="../types/dishko-extension.d.ts" />
"use strict";

// Prima Inspirace (primainspirace.cz) – domácí kuchyně a pečení s přesnými gramážemi.
// Web běží na WordPressu s veřejným REST API:
//  - výpis/hledání: /wp-json/wp/v2/posts?categories=<id>&search=<dotaz>&page=N
//  - detail:        /wp-json/wp/v2/posts?slug=<slug>  (obsah článku parsujeme z HTML,
//                   web nemá Schema.org Recipe JSON-LD)
// Struktura článku: <h2>Co budeme potřebovat</h2> (<h3>skupina</h3> + <ul><li>surovina</li>)
// a <h2>Postup přípravy…</h2> (<p><strong>1. Krok:</strong> text</p> nebo <ol><li>).

const BASE_URL = "https://primainspirace.cz";
const API = BASE_URL + "/wp-json/wp/v2";
const RECIPES_CATEGORY = 319299;
const PAGE_SIZE = 20;
const LIST_FIELDS = "id,link,title,categories,yoast_head_json.og_image";

const CATEGORIES = [
  ["", "Všechny recepty"],
  ["54527745", "Slané recepty"],
  ["54527695", "Sladké recepty"],
  ["54527693", "Vánoční cukroví"],
  ["54529036", "Jablečné koláče"],
  ["54533870", "Polévky"],
  ["54533895", "Saláty"],
  ["54533896", "Přílohy"],
  ["54530677", "Pomazánky"],
  ["54538099", "Občerstvení"],
  ["54534062", "Domácí pečivo"],
  ["54545227", "Zdravé recepty"],
  ["54533894", "Velikonoční recepty"],
  ["54528024", "Recepty od čtenářů"],
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

function getJson(url) {
  const res = dishko.http.get(url, { Accept: "application/json" });
  // WordPress vrací 400 (rest_post_invalid_page_number) pro stránku za koncem výpisu.
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error("HTTP " + res.status + " (" + url + ")");
  return JSON.parse(res.body);
}

function ogImage(post) {
  const og = post && post.yoast_head_json && post.yoast_head_json.og_image;
  return og && og.length > 0 && og[0].url ? absoluteUrl(og[0].url) : null;
}

function toCard(post) {
  if (!post || !post.link) return null;
  const title = htmlToText(post.title && post.title.rendered);
  if (!title) return null;
  const cat = CATEGORIES.find(c => c[0] && (post.categories || []).indexOf(parseInt(c[0], 10)) >= 0);
  return {
    id: post.link.replace(BASE_URL, ""),
    title: title,
    imageUrl: ogImage(post),
    summary: cat ? cat[1] : null,
    sourceUrl: post.link,
  };
}

function listPosts(params, page) {
  const url =
    API +
    "/posts?per_page=" + PAGE_SIZE +
    "&page=" + Math.max(1, page) +
    "&_fields=" + LIST_FIELDS +
    params;
  const posts = getJson(url) || [];
  const seen = new Set();
  const items = posts.map(toCard).filter(c => c && !seen.has(c.id) && seen.add(c.id));
  return { items: items, hasNextPage: posts.length >= PAGE_SIZE };
}

function categoryParam(filters) {
  const cat = filters && filters.category;
  return "&categories=" + encodeURIComponent(cat || String(RECIPES_CATEGORY));
}

function slugFromId(id) {
  const path = String(id).replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function cleanIngredient(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .replace(/[,;.]\s*$/, "")
    .trim();
}

function cleanStep(t) {
  return String(t || "")
    .replace(/^\s*(krok\s*)?\d+\s*[.):]\s*/i, "")
    .trim();
}

// AngleSharp bridge nevrací název tagu – projdeme proto obsah po jednotlivých selektorech
// a sestavíme pořadí uzlů podle pozice v HTML.
function orderedNodes(html) {
  const tags = ["h2", "h3", "h4", "li", "p"];
  const re = /<(h2|h3|h4|li|p)(\s[^>]*)?>/gi;
  const order = [];
  let m;
  while ((m = re.exec(html)) !== null) order.push(m[1].toLowerCase());
  const doc = dishko.html.parse("<div>" + html + "</div>");
  const lists = {};
  tags.forEach(t => (lists[t] = doc.select(t)));
  const idx = { h2: 0, h3: 0, h4: 0, li: 0, p: 0 };
  const out = [];
  order.forEach(t => {
    const n = lists[t][idx[t]++];
    if (n) out.push({ tag: t, node: n });
  });
  return out;
}

function parseRecipeContent(html) {
  const clean = String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "");
  const ingredients = [];
  const steps = [];
  let section = null;
  let group = null;

  orderedNodes(clean).forEach(item => {
    const tag = item.tag;
    const text = item.node.text();
    if (!text) return;
    const isHeading = tag === "h2" || tag === "h3" || tag === "h4";

    if (isHeading && /potřeb|surovin|ingredienc/i.test(text)) {
      section = "ingredients";
      group = null;
      return;
    }
    if (isHeading && /postup|příprav|jak na to/i.test(text) && !/surovin/i.test(text)) {
      section = "steps";
      return;
    }
    if (tag === "h2") {
      section = null;
      return;
    }

    if (section === "ingredients") {
      if (isHeading) group = text.replace(/:\s*$/, "").trim() || null;
      else if (tag === "li") {
        const raw = cleanIngredient(text);
        if (raw) ingredients.push({ rawText: raw, groupName: group });
      }
    } else if (section === "steps" && !isHeading) {
      // <p> uvnitř <li> by se jinak započítal dvakrát.
      const step = cleanStep(text);
      if (step && steps.indexOf(step) < 0 && !steps.some(s => s.indexOf(step) >= 0)) steps.push(step);
    }
  });
  return { ingredients: ingredients, steps: steps };
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
    return listPosts(categoryParam(filters), page);
  },

  search(query, page, filters) {
    const q = String(query || "").trim();
    if (!q) return { items: [], hasNextPage: false };
    return listPosts("&search=" + encodeURIComponent(q) + categoryParam(filters), page);
  },

  getRecipeDetail(id) {
    const slug = slugFromId(id);
    if (!slug) throw new Error("Neplatné ID receptu: " + id);
    const posts =
      getJson(
        API + "/posts?slug=" + encodeURIComponent(slug) +
        "&_fields=id,link,title,content,excerpt,categories,yoast_head_json.og_image"
      ) || [];
    const post = posts[0];
    if (!post) throw new Error("Recept nenalezen: " + slug);

    const parsed = parseRecipeContent(post.content && post.content.rendered);
    const cats = CATEGORIES.filter(c => c[0] && (post.categories || []).indexOf(parseInt(c[0], 10)) >= 0).map(c => c[1]);
    const intro = htmlToText(post.excerpt && post.excerpt.rendered).replace(/\s*\[…\]\s*$/, "").replace(/\s*Celý článek.*$/i, "");

    const text = htmlToText(post.content && post.content.rendered);
    const servings = text.match(/(?:pro|na)\s+(\d+)\s+(?:osob|porc|lidi|strávník)/i);

    let notes = intro || null;
    if (parsed.ingredients.length === 0 && parsed.steps.length === 0) {
      // Souhrnné články ("14 receptů na guláš") nemají vlastní suroviny ani postup.
      notes = (notes ? notes + "\n\n" : "") + "Souhrnný článek s odkazy na více receptů: " + post.link;
    }

    return {
      title: htmlToText(post.title && post.title.rendered),
      sourceUrl: post.link,
      servings: servings ? parseInt(servings[1], 10) : undefined,
      servingsLabel: "porce",
      notes: notes,
      imageUrls: [ogImage(post)].filter(Boolean),
      ingredients: parsed.ingredients,
      steps: parsed.steps,
      suggestedTags: cats,
    };
  },
});
