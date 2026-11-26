# Dishko Extensions Specification (API v1)

This document defines the repository manifest format (`repo.json`), extension script contract (`apiVersion: 1`), host bridge API (`dishko.*`), and sandbox security guarantees for Dishko recipe source extensions.

---

## 1. Overview

Dishko extensions allow any community author to add live recipe browsing, searching, and recipe import for regional or specialized recipe websites (Czech, Slovak, Irish, English, etc.) without modifying Dishko itself.

- Extensions are plain JavaScript files distributed via static HTTP(S) repositories (`repo.json`).
- Scripts run **server-side inside an isolated Jint sandbox** on the household's own Dishko instance.
- Requests are made live on demand when a user browses or searches, strictly constrained to the extension's declared `allowedDomains` and protected by Dishko's SSRF guard (`PublicAddress`).
- Only a household **Admin** can add repositories and install/update extensions.

---

## 2. Repository Manifest (`repo.json`)

A repository is any publicly reachable `https://` (or `http://` in development) JSON file with the following schema:

```json
{
  "schemaVersion": 1,
  "id": "cz-community-recipes",
  "name": "České recepty",
  "description": "Komunitní zdroje českých receptových webů",
  "homepage": "https://github.com/example/dishko-cz-recipes",
  "extensions": [
    {
      "id": "cz.example-recepty",
      "name": "ExampleRecepty.cz",
      "version": "1.0.0",
      "apiVersion": 1,
      "lang": "cs",
      "iconUrl": "https://example.github.io/dishko-cz/icons/example.png",
      "scriptUrl": "https://example.github.io/dishko-cz/scripts/example.js",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "allowedDomains": ["www.example-recepty.cz", "example-recepty.cz"],
      "capabilities": ["browse", "search", "filters"]
    }
  ]
}
```

### Repository Fields

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schemaVersion` | integer | Yes | Must be `1`. |
| `id` | string | Yes | Stable slug (`[a-z0-9._-]`, 2–64 chars). |
| `name` | string | Yes | Display name (1–80 chars). |
| `description` | string | No | Short description (max 300 chars). |
| `homepage` | string | No | Valid `http(s)` URL for repository docs/source. |
| `extensions` | array | Yes | List of extension entries (unique `id` per repository). |

### Extension Entry Fields

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | string | Yes | Globally scoped reverse-style or `<lang>.<slug>` identifier (`[a-z0-9._-]`, 3–80 chars). |
| `name` | string | Yes | Display name shown in Discover UI (1–80 chars). |
| `version` | string | Yes | SemVer string (`MAJOR.MINOR.PATCH`). |
| `apiVersion` | integer | Yes | Must be `1`. |
| `lang` | string | Yes | BCP-47 / ISO 639-1 language code (`cs`, `sk`, `en`, `en-IE`, `multi`). |
| `iconUrl` | string | No | Valid `http(s)` URL to a square icon image. |
| `scriptUrl` | string | Yes | Valid `http(s)` URL to the JS script file. |
| `sha256` | string | Yes | 64-char lowercase hex SHA-256 hash of the exact UTF-8 script bytes. Verified on install/update. |
| `allowedDomains` | string[] | Yes | Non-empty list of allowed host patterns (e.g. `"toprecepty.cz"`, `"*.toprecepty.cz"`). Wildcard `"*"` is forbidden. |
| `capabilities` | string[] | Yes | Subset of `["browse", "search", "filters"]`. |

---

## 3. Extension Script Contract (`apiVersion: 1`)

Each script must register a single source object by calling the global `defineSource(source)` function during top-level script evaluation.

```js
defineSource({
  getFilters() {
    // Optional (used when "filters" capability is declared)
    return [
      {
        id: "category",
        label: "Kategorie",
        options: [
          { value: "", label: "Vše" },
          { value: "hlavni-jidla", label: "Hlavní jídla" }
        ]
      }
    ];
  },

  getPopular(page, filters) {
    // Required when "browse" capability is declared.
    // page is 1-based integer; filters is an object { [filterId]: value }.
    return {
      items: [
        {
          id: "/recept/123-svickova",
          title: "Svíčková na smetaně",
          imageUrl: "https://www.example-recepty.cz/img/123.jpg",
          summary: "90 min · 4 porce",
          sourceUrl: "https://www.example-recepty.cz/recept/123-svickova"
        }
      ],
      hasNextPage: true
    };
  },

  search(query, page, filters) {
    // Required when "search" capability is declared.
    return {
      items: [],
      hasNextPage: false
    };
  },

  getRecipeDetail(id) {
    // Always required.
    return {
      title: "Svíčková na smetaně",
      sourceUrl: "https://www.example-recepty.cz/recept/123-svickova",
      servings: 4,
      servingsLabel: "porce",
      prepTimeMinutes: 30,
      cookTimeMinutes: 90,
      notes: "Volitelné poznámky autora",
      imageUrls: ["https://www.example-recepty.cz/img/123.jpg"],
      ingredients: [
        // Either rawText (parsed by Dishko) or structured fields:
        { rawText: "600 g hovězí zadní" },
        { name: "mrkev", quantity: 2, unit: "Piece", note: "nastrouhaná", groupName: "Základ" }
      ],
      steps: [
        "Maso osolíme a prošpikujeme.",
        "Orestujeme kořenovou zeleninu a dusíme doměkka."
      ],
      suggestedTags: ["hovězí", "hlavní jídlo"]
    };
  }
});
```

---

## 4. Host Bridge API (`dishko`)

Extensions have **no access** to Node APIs, browser DOM, .NET CLR types, filesystem, environment variables, or arbitrary sockets. Only the `dishko` global object is exposed:

### 4.1 `dishko.http`

- `dishko.http.get(url, headers?)` → `{ status, ok, url, contentType, body }`
- `dishko.http.post(url, body, contentType?, headers?)` → `{ status, ok, url, contentType, body }`

Enforcement:
- Only `http://` and `https://` URLs with no embedded userinfo.
- Target hostname **and every redirect target** must match the extension's `allowedDomains`.
- Every TCP connection passes through `PublicAddress` (blocks loopback, RFC1918 private ranges, CGNAT, link-local, multicast, IPv6 ULA/link-local).
- Per-execution request budget (default max 5 requests), response size cap (default 2 MB), and HTTP timeout.

### 4.2 `dishko.html`

Backed natively by **AngleSharp**:

- `dishko.html.parse(html)` → `HtmlNode`
- `node.select(cssSelector)` → `HtmlNode[]`
- `node.selectOne(cssSelector)` → `HtmlNode | null`
- `node.text()` → trimmed text content (collapsed whitespace)
- `node.innerHtml()` → inner HTML string
- `node.attr(name)` → attribute value or `null`

### 4.3 `dishko.jsonLd`

Native Schema.org `Recipe` extractor supporting single objects, JSON arrays, `@graph`, localized types, ISO-8601 durations (`PT1H30M`), `HowToStep` / `HowToSection` instructions, and multiple image formats:

- `dishko.jsonLd.extractRecipe(html, sourceUrl?)` → recipe detail object matching `getRecipeDetail`'s return contract, or `null` if no `Recipe` JSON-LD block is found.

---

## 5. Sandbox Limits (Defaults)

Configured via `Extensions` section in `appsettings.json` (`ExtensionsOptions`):

| Setting | Default | Purpose |
| --- | --- | --- |
| `Allowed` | `true` | Master kill switch (`false` disables all extension endpoints and execution). |
| `ExecutionTimeoutSeconds` | `5` | Maximum JS CPU execution time per call. |
| `HttpTimeoutSeconds` | `10` | Maximum duration per outbound HTTP call. |
| `MaxHttpRequestsPerCall` | `5` | Maximum outbound HTTP requests per extension invocation. |
| `MaxHttpResponseBytes` | `2097152` (2 MB) | Maximum body size per HTTP response. |
| `MemoryLimitBytes` | `16777216` (16 MB) | Jint engine heap allocation limit. |
| `MaxStatements` | `50000` | Statement execution cap to stop tight loops quickly. |
| `MaxRecursionDepth` | `64` | JS call stack depth cap. |
| `ScriptMaxBytes` | `524288` (512 KB) | Maximum script size when installing from a repository. |
| `RequestsPerMinutePerSource` | `30` | Per-source rate limit (applied on cache misses). |

---

## 6. Authoring, Local Testing & Publishing (Extension SDK)

Everything needed to author, test, and host a regional repository lives in `tools/extension-sdk/` and `tools/Dishko.ExtensionCli/`:

- **AI authoring guide & prompt playbook:** [`docs/extensions-ai-guide.md`](extensions-ai-guide.md) (and drop-in repo instructions in [`tools/extension-sdk/template/AGENTS.md`](../tools/extension-sdk/template/AGENTS.md)) — complete sandbox rules, common pitfalls, error-code troubleshooting, and copy-paste prompts for generating new extensions with AI coding agents.
- **TypeScript / JS editor autocomplete:** `tools/extension-sdk/types/dishko-extension.d.ts` (reference it at the top of any `.js` extension via `/// <reference path="..." />`).
- **Starter repository template & reference extensions:** `tools/extension-sdk/template/`:
  - `extensions/en.themealdb.js` – live English JSON API reference (`www.themealdb.com`).
  - `extensions/cz.jsonld-starter.js` – Czech HTML + AngleSharp + `dishko.jsonLd.extractRecipe(...)` starter.
  - `scripts/build-repo.mjs` – zero-dependency Node.js generator that computes SHA-256 hashes from `manifest.template.json` and writes `repo.json`.
  - `publish-repo.workflow.yml` – GitHub Actions workflow to publish `repo.json` and `extensions/*.js` to GitHub Pages.
- **Local CLI sandbox runner (`tools/Dishko.ExtensionCli`):** runs scripts inside Dishko's exact `ExtensionRuntime`, `PublicAddress` SSRF guard, `DomainAllowlist`, and `IngredientLineParser`:

```bash
# Run an extension locally inside Dishko's sandbox
dotnet run --project tools/Dishko.ExtensionCli -- run <script.js> --domains <host> popular 1
dotnet run --project tools/Dishko.ExtensionCli -- run <script.js> --domains <host> search "guláš" 1
dotnet run --project tools/Dishko.ExtensionCli -- run <script.js> --domains <host> detail <id> --parse-ingredients

# Build & validate repo.json (including SHA-256 verification against local script files)
dotnet run --project tools/Dishko.ExtensionCli -- build-manifest manifest.template.json --out repo.json --base-url https://user.github.io/repo
dotnet run --project tools/Dishko.ExtensionCli -- validate repo.json --scripts-dir .
```
