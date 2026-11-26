# Dishko Extensions — AI Authoring Guide

This guide is a self-contained reference for AI coding agents (Claude, Gemini, Codex, Cursor, Antigravity, Copilot) and human authors generating **Dishko recipe source extensions** (`apiVersion: 1`) and **multi-extension repositories** (`repo.json`).

Give an AI this file (or drop [`tools/extension-sdk/template/AGENTS.md`](../tools/extension-sdk/template/AGENTS.md) into the root of an extension repository) and ask it to add a website.

---

## 1. Repository Architecture

One Git repository hosts **one or many** recipe extensions inside a single `repo.json` catalog. Administrators add the repository URL once in Dishko (**Settings › Recipe sources › Add repository**) and selectively install, toggle, or update individual extensions.

```text
my-dishko-extensions/
├── AGENTS.md                        # AI instructions (copy from tools/extension-sdk/template/AGENTS.md)
├── manifest.template.json           # Source of truth for repo metadata + extension list (no manual hashes)
├── repo.json                        # Generated output (computed SHA-256 + full scriptUrl per extension)
├── extensions/
│   ├── cz.site-one.js               # One self-contained JS file per recipe website
│   └── sk.site-two.js
├── icons/                           # Optional square icons (png/webp/svg)
├── scripts/
│   └── build-repo.mjs               # Zero-dependency Node script: manifest.template.json -> repo.json
└── .github/workflows/
    └── publish-repo.yml             # Publishes _site/repo.json + extensions/*.js to GitHub Pages
```

Starter template files live in [`tools/extension-sdk/template/`](../tools/extension-sdk/template/).

---

## 2. Hard Sandbox Constraints (Read Before Writing Any Code)

Dishko executes every extension call in a **fresh, isolated Jint JavaScript engine** on the Dishko server. Violating any rule below causes immediate runtime failure:

| Rule | Details |
| --- | --- |
| **Synchronous JS only** | **NEVER** use `async`, `await`, or `Promise`. `dishko.http.get` and `dishko.http.post` are synchronous blocking bridge calls. An `async` handler returns a `Promise` object instead of data and fails contract validation (`extensions.invalid_contract`). |
| **No Node or Browser APIs** | **NEVER** use `fetch`, `axios`, `cheerio`, `require`, `import`, `export`, `URL`, `URLSearchParams`, `DOMParser`, `document`, `window`, `Buffer`, `process`, `fs`, `setTimeout`, or `console.log` (`console` is not defined and throws `ReferenceError`). |
| **Strict ES single file** | Runs in JavaScript strict mode (`"use strict"`). Standard ES built-ins are available: `JSON`, `RegExp`, `Math`, `Date`, `Map`, `Set`, `Array`, `Object`, `String`, `Number`, `encodeURIComponent`, `decodeURIComponent`, optional chaining `?.`, nullish coalescing `??`, arrow functions, template literals. |
| **Stateless per call** | Every call (`getFilters`, `getPopular`, `search`, `getRecipeDetail`) gets a brand-new engine. Do not rely on module-level caches across calls (Dishko caches responses server-side). Do **not** perform HTTP requests at top-level evaluation time. |
| **Execution budgets** | Max **5 HTTP requests** per call, **10 s** per HTTP request, **2 MB** max HTTP response body, **3 redirects** max, **5 s** JS CPU time, **50 000** JS statements, **16 MB** heap memory, **64** recursion depth, **512 KB** max script file size. |
| **Strict domain allowlist** | Every HTTP request **and every redirect target** must match `allowedDomains` in the manifest and resolve to a public IP (SSRF protection blocks `localhost`, private LAN IPs, link-local, etc.). |
| **Plain HTTP only (no browser)** | Dishko uses plain .NET `HttpClient` — it does not execute page JavaScript or solve anti-bot challenges / CAPTCHAs. If a site is a JS-only SPA, look for its public JSON/GraphQL/RSS/sitemap endpoint; if it is behind Cloudflare Turnstile, login walls, or CAPTCHA, stop and tell the user it cannot be scraped cleanly. |

---

## 3. Host Bridge API (`dishko`)

Only two globals are injected by Dishko: `defineSource(source)` and `dishko`.

### 3.1 `dishko.http`

```ts
dishko.http.get(url: string, headers?: Record<string, string>): {
  status: number;
  ok: boolean;          // true for HTTP 2xx
  url: string;          // final URL after redirects
  contentType: string | null;
  body: string;
}

dishko.http.post(
  url: string,
  body: string,
  contentType?: string, // defaults to "application/x-www-form-urlencoded"
  headers?: Record<string, string>
): HttpResponse
```

Important behavior:
- Non-2xx status codes do **not** throw — always check `if (!res.ok) throw new Error(\`HTTP \${res.status}\`);`.
- Forbidden headers (`Host`, `Connection`, `Keep-Alive`, `Transfer-Encoding`, `Content-Length`, `Proxy-Authorization`, `Proxy-Connection`) are ignored. `Authorization` and `Cookie` are stripped across redirects.
- Network errors, blocked domains, >3 redirects, >2 MB response, timeouts, and >5 calls throw sandbox errors.

### 3.2 `dishko.html` (AngleSharp HTML5 Parser)

```ts
const doc = dishko.html.parse(html);
doc.select(cssSelector);    // HtmlNode[] — capped at 500 elements per call
doc.selectOne(cssSelector); // HtmlNode | null
node.text();                // Trimmed text with collapsed whitespace
node.innerHtml();           // Inner HTML string
node.attr(name);            // Attribute value or null
```

Important behavior:
- Use **standard CSS selectors only**. jQuery pseudo-selectors (`:contains(...)`, `:eq(...)`, `:first`) throw `extensions.invalid_selector`.
- `node.text()` already trims and collapses whitespace — avoid redundant heavy regex loops that burn the 50 000 statement budget.

### 3.3 `dishko.jsonLd` (Schema.org Recipe Extractor)

```ts
const recipe = dishko.jsonLd.extractRecipe(html, sourceUrl?);
// Returns a plain DishkoRecipeDetail object or null if no Schema.org Recipe JSON-LD is found.
```

Handles `<script type="application/ld+json">`, single objects, arrays, `@graph`, `mainEntity`, `HowToStep`, `HowToSection`, ISO-8601 durations (`PT1H30M`), multiple `image` shapes, and relative URL resolution using `sourceUrl`. Because it returns a plain JS object, you can enrich missing fields (e.g. `servings`, `notes`, `suggestedTags`, grouped ingredients) before returning it.

---

## 4. Extension Script Contract (`defineSource`)

Full TypeScript definitions: [`tools/extension-sdk/types/dishko-extension.d.ts`](../tools/extension-sdk/types/dishko-extension.d.ts).

Start every `.js` file with a triple-slash reference (adjust relative path) so editors validate types:

```js
/// <reference path="../../types/dishko-extension.d.ts" />
```

### Required & Optional Methods

```js
defineSource({
  // Optional — implement when "filters" is listed in manifest capabilities.
  getFilters() {
    return [
      {
        id: "category",
        label: "Kategorie",
        options: [
          { value: "", label: "Vše" }, // "" represents no filter selected
          { value: "polevky", label: "Polévky" },
        ],
      },
    ];
  },

  // Required when "browse" is in manifest capabilities. page is 1-based integer.
  getPopular(page, filters) {
    return {
      items: [
        {
          id: "/recept/123-gulas",                      // Required non-empty string
          title: "Hovězí guláš",                        // Required non-empty string
          imageUrl: "https://example.cz/img/123.jpg",   // Optional absolute http(s) URL
          summary: "90 min · 4 porce",                  // Optional short subtitle
          sourceUrl: "https://example.cz/recept/123-gulas", // Canonical URL (enables "In cookbook" badge)
        },
      ],
      hasNextPage: true,                                // Boolean
    };
  },

  // Required when "search" is in manifest capabilities. page is 1-based integer.
  // MUST work when filters is {} (Dishko's multi-source search passes no filters).
  search(query, page, filters) {
    return { items: [], hasNextPage: false };
  },

  // ALWAYS required.
  // BEST PRACTICE: Accept BOTH card id (e.g. "/recept/123" or "123") AND a full "https://..." URL,
  // because Dishko's "Import from URL" passes the full URL here when its domain matches allowedDomains.
  getRecipeDetail(id) {
    return {
      title: "Hovězí guláš",                 // Required non-empty string
      sourceUrl: "https://example.cz/recept/123-gulas",
      servings: 4,                           // Positive number (defaults to 4 if omitted)
      servingsLabel: "porce",                // Optional ("porce", "ks", "plech", "servings")
      prepTimeMinutes: 20,                   // Optional integer (drives Quick vs Demanding suggestion)
      cookTimeMinutes: 90,                   // Optional integer
      notes: "Volitelný popis či tip",       // Optional
      imageUrls: ["https://example.cz/img/123.jpg"], // First valid http(s) image = default cover photo
      ingredients: [
        // Prefer rawText and let Dishko's CZ/SK/EN IngredientLineParser parse quantity, unit, name & prep note:
        { rawText: "600 g hovězí kližky, nakrájené na kostky", groupName: "Maso" },
        // Or pass structured fields when the site already provides separate columns:
        { name: "cibule", quantity: 3, unit: "Piece", note: "nadrobno" },
      ],
      steps: [
        "Cibuli osmahněte dozlatova.",       // Plain strings; strip leading "1. " / "2) " numbering
        "Přidejte maso a duste doměkka.",
      ],
      suggestedTags: ["hovězí", "hlavní jídlo"], // Used by Dishko to auto-suggest DishType & ProteinTag
    };
  },
});
```

### Rules That Prevent Silent Bugs

1. **Always return absolute `http(s)` URLs** for `imageUrl`, `sourceUrl`, and `imageUrls`. Write a small helper (`absoluteUrl(href)`) — do not use `new URL(...)`.
2. **Always set `sourceUrl` on listing cards** — Dishko compares `card.sourceUrl` against saved household recipes to display the *"V kuchařce" / "In cookbook"* badge and warn about duplicates.
3. **Cards missing `id` or `title` are silently dropped** by the runtime. Deduplicate cards by `id` if the site repeats featured links.
4. **Check lazy-loaded image attributes** (`data-src`, `data-lazy-src`, `data-original`, `srcset`, `src`) and skip inline `data:image/...` placeholder URIs.
5. **Prefer `{ rawText }` for ingredients** (optionally with `groupName`). Dishko's `IngredientLineParser` already handles Czech, Slovak, and English quantities, unicode/ASCII fractions (`½`, `3/4`), ranges (`2–3`), multi-word units (`polévková lžíce`, `fl oz`), and parenthetical/comma prep notes.
   - If you supply structured `unit`, use one of Dishko's canonical unit names (`Gram`, `Kilogram`, `Milliliter`, `Deciliter`, `Liter`, `Teaspoon`, `Tablespoon`, `Cup`, `FluidOunce`, `Ounce`, `Pound`, `Piece`, `Pinch`, `Clove`, `Slice`, `Bunch`, `Can`, `Package`) or a standard CZ/SK/EN alias (`g`, `kg`, `ml`, `dl`, `l`, `lžíce`, `lžička`, `ks`, `tbsp`, `tsp`, `cup`).
6. **Handle full URLs in `getRecipeDetail(id)`** whenever possible:
   ```js
   const url = /^https?:\/\//i.test(id) ? id : absoluteUrl(id);
   ```
   This enables both Discover browsing and Dishko's **Import from URL** feature with zero extra code.
7. **Always `encodeURIComponent(query)`** in search URLs (critical for diacritics like `svíčková`, `guláš`, `halušky`).
8. **Handle empty search results gracefully**: return `{ items: [], hasNextPage: false }` instead of throwing when a search finds 0 recipes (watch out for sites returning HTTP 404 for empty search pages!).

---

## 5. Manifest Validation Rules (`manifest.template.json` → `repo.json`)

Every rule below is enforced strictly by `ManifestValidator` when Dishko loads `repo.json`:

| Field | Rule |
| --- | --- |
| `schemaVersion` | Must be `1`. |
| Repo `id` | `^[a-z0-9][a-z0-9._-]*$`, 2–64 chars (e.g. `cz-community-recipes`). |
| Repo `name` | 1–80 chars. `description`: optional, max 300 chars. `homepage`: optional `http(s)` URL. |
| Extension `id` | `^[a-z0-9][a-z0-9._-]*$`, 3–80 chars, unique per repo. Convention: `<lang>.<site>` (e.g. `cz.apetitonline`, `en.themealdb`). |
| Extension `name` | 1–80 chars. |
| `version` | SemVer (`MAJOR.MINOR.PATCH`, optional `-prerelease`). **Bump version on every script edit** so Dishko detects updates and invalidates cache. |
| `apiVersion` | Must be `1`. |
| `lang` | ISO 639-1 / BCP-47 tag (`cs`, `sk`, `en`, `en-IE`, `de`, `multi`). |
| `iconUrl` | Optional valid `http(s)` URL. |
| `scriptFile` *(template only)* | Relative path to `.js` file (e.g. `extensions/cz.example.js`). Replaced by `scriptUrl` + `sha256` during build. |
| `sha256` *(generated `repo.json`)* | 64-char lowercase hex SHA-256 of exact UTF-8 script bytes. **Always generate via `build-repo.mjs` or `Dishko.ExtensionCli build-manifest` — never compute by hand.** |
| `allowedDomains` | Non-empty array. Exact hosts (`example.cz`, `www.example.cz`) or subdomain wildcards (`*.example.cz`). **Gotcha:** `*.example.cz` matches `www.example.cz` and `api.example.cz`, **not** the apex `example.cz`! If the site redirects `example.cz` ↔ `www.example.cz`, list **both**. Global `*`, bare TLDs (`*.cz`), and IP literals are rejected. |
| `capabilities` | Non-empty subset of `["browse", "search", "filters"]`. Only declare capabilities whose methods exist on `defineSource(...)`. |

---

## 6. Recommended Step-by-Step AI Workflow

When asked to create an extension for a target recipe website, follow these exact steps:

1. **Inspect the live site first — NEVER guess selectors or endpoints from memory.**
   - Fetch the site's listing page, a search query page (test diacritics like `guláš` or `kuře` for CZ/SK sites), and one full recipe detail page.
   - Check in order of preference:
     1. **Public JSON / REST / WP-JSON API** (cleanest, fastest, smallest payload; see [`en.themealdb.js`](../tools/extension-sdk/template/extensions/en.themealdb.js)).
     2. **HTML listing + `dishko.jsonLd.extractRecipe(html, url)`** for detail pages, with AngleSharp CSS fallback (see [`cz.jsonld-starter.js`](../tools/extension-sdk/template/extensions/cz.jsonld-starter.js)).
     3. **Pure AngleSharp HTML scraping** when no JSON-LD exists.
   - Check redirects (`http` → `https`, apex ↔ `www`, CDN/API hostnames) so every contacted host is listed in `allowedDomains`.
   - Verify whether the site requires JavaScript rendering or blocks plain HTTP clients (Cloudflare/CAPTCHA). If blocked with no public API/RSS alternative, stop and inform the user.

2. **Write the extension script** under `extensions/<id>.js`:
   - Include `/// <reference path="..." />` at the top.
   - Keep it synchronous, strict, clean, and well under 512 KB and 50 000 statements per call.
   - Support full URLs in `getRecipeDetail(id)` and empty `filters` in `search(query, page, filters)`.

3. **Register it in `manifest.template.json`** with accurate `allowedDomains` and `capabilities`.

4. **Test every capability live inside Dishko's real sandbox via `Dishko.ExtensionCli`:**
   ```bash
   # Filters (if declared)
   dotnet run --project <dishko-path>/tools/Dishko.ExtensionCli -- run \
     extensions/<id>.js --domains <host1,host2> filters

   # Browse page 1 (and page 2 to verify pagination)
   dotnet run --project <dishko-path>/tools/Dishko.ExtensionCli -- run \
     extensions/<id>.js --domains <host1,host2> popular 1

   # Search (use a realistic query with diacritics if non-English)
   dotnet run --project <dishko-path>/tools/Dishko.ExtensionCli -- run \
     extensions/<id>.js --domains <host1,host2> search "guláš" 1

   # Detail + verify Dishko's ingredient parser output!
   dotnet run --project <dishko-path>/tools/Dishko.ExtensionCli -- run \
     extensions/<id>.js --domains <host1,host2> detail "<id-from-above>" --parse-ingredients

   # Also test detail with a full canonical https:// URL (verifies Import from URL compatibility)
   dotnet run --project <dishko-path>/tools/Dishko.ExtensionCli -- run \
     extensions/<id>.js --domains <host1,host2> detail "https://..." --parse-ingredients
   ```
   Inspect the JSON output carefully:
   - `items` non-empty, `title` clean (no stray badges/newlines), `imageUrl` & `sourceUrl` are valid `https://` URLs.
   - `parsedIngredients` shows sensible `quantity`, `unit`, `cleanName`, and `note` (no HTML tags, no bullet chars, no duplicated text).
   - `steps` are clean individual instructions without leading numbers or ad/promo paragraphs.

5. **Rebuild and validate `repo.json`:**
   ```bash
   node scripts/build-repo.mjs --base-url https://<user>.github.io/<repo>
   dotnet run --project <dishko-path>/tools/Dishko.ExtensionCli -- validate repo.json --scripts-dir .
   ```

---

## 7. Common Sandbox Error Codes & Fixes

| Error Code | Typical Cause | Fix |
| --- | --- | --- |
| `extensions.invalid_contract` | Used `async` function (returns a `Promise`), forgot `defineSource({...})`, missing method for a declared capability, or `getRecipeDetail` returned empty `title`. | Make all functions synchronous; return `{ items, hasNextPage }` / `{ title, ingredients, steps }`. |
| `extensions.domain_blocked` | Request or HTTP redirect hit a host not listed in `allowedDomains`. | Add the missing host (e.g. both `example.cz` and `www.example.cz`, or `api.example.cz`) to `allowedDomains`. |
| `extensions.script_error` | JS syntax error, `ReferenceError` (e.g. `console.log`, `fetch`, `URL`), or `throw new Error(...)` on non-2xx HTTP status. | Remove browser/Node globals; inspect HTTP status and HTML structure. |
| `extensions.invalid_selector` | Non-standard / jQuery CSS selector passed to `select()` or `selectOne()`. | Use standard CSS3 selectors supported by AngleSharp. |
| `extensions.http_limit_exceeded` | Script made more than 5 HTTP calls in a single invocation. | Never fetch per-card detail pages inside `getPopular`/`search` — parse card metadata directly from the listing response. |
| `extensions.statement_limit` | Tight loop, catastrophic regex, or scanning huge HTML manually. | Use `dishko.html.parse` + targeted CSS selectors instead of manual string/regex loops over raw HTML. |
| `extensions.response_too_large` | Fetched endpoint returned >2 MB body. | Use paginated endpoints or smaller API responses. |
| `extensions.hash_mismatch` | Script edited after `repo.json` was generated. | Re-run `scripts/build-repo.mjs` (or `Dishko.ExtensionCli build-manifest`) and bump `version`. |

---

## 8. Copy-Paste Prompt Templates for Users

### Czech prompt (new extension in your repo)
> Přečti si `AGENTS.md` (nebo `docs/extensions-ai-guide.md`) a vytvoř nové Dishko rozšíření pro web `https://<cilovy-web>`.
> 1. Nejdřív si prohlédni reálnou strukturu výpisu receptů, vyhledávání a detailu receptu na tom webu (ověř, jestli má veřejné JSON API nebo Schema.org JSON-LD).
> 2. Napiš skript do `extensions/<lang>.<nazev>.js` (čistý synchronní JS pro Jint sandbox, podpora plné URL v `getRecipeDetail`, správné `allowedDomains`).
> 3. Přidej záznam do `manifest.template.json`.
> 4. Otestuj `filters`, `popular`, `search` a `detail --parse-ingredients` přes `Dishko.ExtensionCli` proti živému webu, přegeneruj `repo.json` a ověř ho přes `validate`.

### English prompt (new extension in your repo)
> Read `AGENTS.md` (or `docs/extensions-ai-guide.md`) and build a Dishko recipe extension for `https://<target-site>`.
> 1. Inspect the live site's listing page, search endpoint, and a recipe detail page first (prefer a public JSON API or HTML listing + `dishko.jsonLd.extractRecipe`).
> 2. Write `extensions/<lang>.<slug>.js` using synchronous Jint-compatible JS only, supporting both card IDs and full canonical URLs in `getRecipeDetail`.
> 3. Register it in `manifest.template.json` with exact `allowedDomains` (including redirect targets) and `capabilities`.
> 4. Test `filters`, `popular`, `search`, and `detail --parse-ingredients` live via `Dishko.ExtensionCli`, regenerate `repo.json`, and run `validate`.
