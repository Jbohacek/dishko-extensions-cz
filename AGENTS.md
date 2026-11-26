# AGENTS.md — Dishko Recipe Extension Repository

This repository hosts one or more **Dishko recipe source extensions** (`apiVersion: 1`) published as a single static `repo.json` catalog.

## Hard Runtime Rules (Jint Sandbox)

Every extension runs server-side inside a fresh, isolated **Jint** JavaScript engine per call.

- **Synchronous JS only**: NEVER use `async`, `await`, or `Promise`. `dishko.http.get` / `post` block synchronously. Returning a `Promise` breaks the contract.
- **No Node or Browser globals**: NEVER use `fetch`, `require`, `import`, `export`, `URL`, `URLSearchParams`, `DOMParser`, `document`, `window`, `Buffer`, `process`, `fs`, `setTimeout`, or `console.log` (`console` throws `ReferenceError`).
- **Strict ES single file**: Top-level script must call `defineSource({...})` with no top-level HTTP calls. Standard ES built-ins (`JSON`, `RegExp`, `Math`, `Date`, `Array`, `Object`, `encodeURIComponent`, `?.`, `??`) are available.
- **Budgets per call**: max **5 HTTP requests**, **10 s** HTTP timeout, **2 MB** response body, **3 redirects**, **5 s** CPU, **50 000** statements, **16 MB** RAM, **512 KB** script size, **500** elements per `select()`.
- **Plain HTTP only**: No headless browser or JS execution. If a site blocks plain HTTP with Cloudflare/CAPTCHA and has no public JSON/RSS API, stop and report it rather than trying to bypass protection.

## Host Bridge API (`dishko`)

- `dishko.http.get(url, headers?)` → `{ status, ok, url, contentType, body }`
- `dishko.http.post(url, body, contentType?, headers?)` → same (`contentType` defaults to `"application/x-www-form-urlencoded"`)
  - Non-2xx does NOT throw; check `if (!res.ok) throw new Error("HTTP " + res.status)`.
  - Every URL and redirect hop must match `allowedDomains` and resolve to a public IP.
- `dishko.html.parse(html)` → `HtmlNode` (AngleSharp; standard CSS selectors only — no jQuery `:contains`/`:eq`)
  - `node.select(css)` (max 500), `node.selectOne(css)`, `node.text()` (trimmed & whitespace-collapsed), `node.innerHtml()`, `node.attr(name)`.
- `dishko.jsonLd.extractRecipe(html, sourceUrl?)` → `DishkoRecipeDetail | null` (supports `@graph`, `mainEntity`, `HowToStep`/`HowToSection`, ISO-8601 durations; returned object can be enriched before returning).

## `defineSource` Contract

```js
defineSource({
  getFilters() { return [{ id: "category", label: "Kategorie", options: [{ value: "", label: "Vše" }] }]; }, // when "filters" in capabilities
  getPopular(page, filters) { return { items: [/* { id, title, imageUrl?, summary?, sourceUrl? } */], hasNextPage: false }; }, // when "browse"
  search(query, page, filters) { return { items: [], hasNextPage: false }; }, // when "search"; MUST work with filters = {}
  getRecipeDetail(id) {
    return {
      title: "...",              // required non-empty string
      sourceUrl: "https://...",
      servings: 4,
      servingsLabel: "porce",
      prepTimeMinutes: 15,
      cookTimeMinutes: 30,
      notes: null,
      imageUrls: ["https://..."],
      ingredients: [{ rawText: "500 g hladké mouky", groupName: null }], // prefer rawText; Dishko parses CZ/SK/EN units & notes
      steps: ["..."],            // strip leading "1. " numbering
      suggestedTags: ["..."],    // helps Dishko suggest DishType & ProteinTag
    };
  },
});
```

### Best Practices

1. **Inspect live pages first** — never guess CSS selectors or API routes.
2. **Prefer** public JSON API → HTML listing + `dishko.jsonLd.extractRecipe(html, url)` (with CSS fallback) → pure CSS scraping.
3. **Support both card `id` and full `https://...` URL in `getRecipeDetail(id)`** (`/^https?:\/\//i.test(id) ? id : absoluteUrl(id)`), because Dishko's *Import from URL* passes the full URL when the domain matches `allowedDomains`.
4. **Always emit absolute `http(s)` URLs** (write a small `absoluteUrl` helper; never use `new URL(...)`) and check lazy-load image attributes (`data-src`, `srcset`, `src`).
5. **Always set `sourceUrl` on listing cards** so Dishko shows the "Already in cookbook" badge.
6. **Always `encodeURIComponent(query)`** and return `{ items: [], hasNextPage: false }` on empty search results.
7. **Manifest `allowedDomains`**: `*.example.cz` does NOT match apex `example.cz` — list both `example.cz` and `www.example.cz` if the site redirects between them. No `*`, no bare TLDs (`*.cz`), no IP literals.
8. **Bump SemVer `version`** in `manifest.template.json` whenever a script changes. Never hand-edit `sha256` in `repo.json`.

## Adding or Updating an Extension

1. Create/edit `extensions/<lang>.<slug>.js` (see `extensions/en.themealdb.js` and `extensions/cz.jsonld-starter.js` as references).
2. Add/update its entry in `manifest.template.json` (`id`, `name`, `version`, `apiVersion: 1`, `lang`, `scriptFile`, `allowedDomains`, `capabilities`).
3. Test against the live target inside Dishko's sandbox CLI (if a local Dishko checkout is available):
   ```bash
   dotnet run --project <dishko>/tools/Dishko.ExtensionCli -- run extensions/<file>.js --domains <d1,d2> popular 1
   dotnet run --project <dishko>/tools/Dishko.ExtensionCli -- run extensions/<file>.js --domains <d1,d2> search "guláš" 1
   dotnet run --project <dishko>/tools/Dishko.ExtensionCli -- run extensions/<file>.js --domains <d1,d2> detail "<id>" --parse-ingredients
   ```
4. Regenerate `repo.json` (and validate if CLI is available):
   ```bash
   node scripts/build-repo.mjs --base-url https://<user>.github.io/<repo>
   dotnet run --project <dishko>/tools/Dishko.ExtensionCli -- validate repo.json --scripts-dir .
   ```

## Site Notes for This Repository

- `cz.fresh-iprima` – `?page=N` on listing pages is cumulative; paginate via `/_snippet/category/{limit}/{offset}/{categoryId}` and `/_snippet/search-content/{limit}/{offset}/{query}` (query is URL-encoded **twice**). Category IDs are hard-coded in `CATEGORIES` (read them from `data-next-link` on `/recepty/<slug>`).
- `cz.toprecepty` – JSON-LD contains group headings as plain ingredients ending with `:`; `regroupIngredients()` turns them into `groupName`.
- `cz.milujivareni` – Next.js site. `/top-recepty` pages are ~1.9 MB (2 MB sandbox limit!) because of the embedded category tree; slice only the `"recipes":[…]` array instead of parsing all of `__NEXT_DATA__`. Search query `s=` is URL-encoded **twice**.
- `cz.apetitonline` – Drupal pager is 0-based (`?page=0` = first page). `/vyhledavani` is blocked by Cloudflare for non-browser clients, so no `search` capability.
- `cz.primainspirace` – WordPress REST API (`/wp-json/wp/v2/posts`, recipes category `319299`); no Recipe JSON-LD, recipe is parsed from `content.rendered` (`<h2>Co budeme potřebovat</h2>` / `<h2>Postup…</h2>`). The bridge does not expose response headers, so `hasNextPage` = full page returned; past-the-end pages return HTTP 400.
- `receptynakazdyden.cz` – fully blocked by Akamai Bot Manager (403 even for `robots.txt`); intentionally not implemented.
