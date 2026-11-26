/**
 * Type definitions for Dishko Recipe Source Extensions (API v1).
 *
 * Add this triple-slash reference at the top of a plain .js extension for IDE autocomplete:
 *   /// <reference path="../types/dishko-extension.d.ts" />
 */

declare type DishkoUnit =
  | "Gram"
  | "Kilogram"
  | "Milliliter"
  | "Deciliter"
  | "Liter"
  | "Teaspoon"
  | "Tablespoon"
  | "Cup"
  | "FluidOunce"
  | "Ounce"
  | "Pound"
  | "Piece"
  | "Pinch"
  | "Clove"
  | "Slice"
  | "Bunch"
  | "Can"
  | "Package";

interface DishkoFilterOption {
  /** Value passed back in filters[filter.id]; use "" for the default/all option. */
  value: string;
  label: string;
}

interface DishkoFilter {
  id: string;
  label: string;
  options: DishkoFilterOption[];
}

interface DishkoRecipeCard {
  /** Stable identifier passed to getRecipeDetail(id) (e.g. a numeric ID, slug, or relative path). */
  id: string;
  title: string;
  imageUrl?: string | null;
  /** Optional short metadata line shown under the title (e.g. "30 min · 4 porce"). */
  summary?: string | null;
  /** Canonical public http(s) URL of the recipe; used to show the "In cookbook" badge. */
  sourceUrl?: string | null;
}

interface DishkoRecipePage {
  items: DishkoRecipeCard[];
  hasNextPage: boolean;
}

interface DishkoIngredientLine {
  /** Raw text line as shown on the site (e.g. "500 g hladké mouky, prosáté"). Parsed by Dishko automatically. */
  rawText?: string | null;
  /** Structured name (if already parsed by the extension; skips raw text splitting). */
  name?: string | null;
  quantity?: number | null;
  /** Either a DishkoUnit enum name or a localized CZ/SK/EN unit alias ("g", "PL", "tbsp", "ks"). */
  unit?: DishkoUnit | string | null;
  note?: string | null;
  groupName?: string | null;
}

interface DishkoRecipeDetail {
  title: string;
  sourceUrl?: string | null;
  servings?: number | null;
  servingsLabel?: string | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  notes?: string | null;
  imageUrls?: string[];
  ingredients: Array<string | DishkoIngredientLine>;
  steps: string[];
  suggestedTags?: string[];
}

interface DishkoSource {
  /** Optional filter definitions (used when "filters" is listed in manifest capabilities). */
  getFilters?(): DishkoFilter[];
  /** Browse / popular listing (1-based page). Required when "browse" is in capabilities. */
  getPopular?(page: number, filters: Record<string, string>): DishkoRecipePage;
  /** Keyword search (1-based page). Required when "search" is in capabilities. */
  search?(query: string, page: number, filters: Record<string, string>): DishkoRecipePage;
  /** Fetch and parse full recipe details for preview and import. Always required. */
  getRecipeDetail(id: string): DishkoRecipeDetail;
}

interface DishkoHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly contentType: string | null;
  readonly body: string;
}

interface DishkoHtmlNode {
  /** Matches all descendant elements (capped at 500 per call). */
  select(cssSelector: string): DishkoHtmlNode[];
  /** Matches the first descendant element or returns null. */
  selectOne(cssSelector: string): DishkoHtmlNode | null;
  /** Trimmed text content with collapsed whitespace. */
  text(): string;
  /** Inner HTML markup of the element. */
  innerHtml(): string;
  /** Attribute value or null when missing. */
  attr(name: string): string | null;
}

interface DishkoHostBridge {
  readonly http: {
    /** Performs an outbound GET limited to manifest allowedDomains and public IPs. */
    get(url: string, headers?: Record<string, string>): DishkoHttpResponse;
    /** Performs an outbound POST limited to manifest allowedDomains and public IPs. */
    post(url: string, body: string, contentType?: string, headers?: Record<string, string>): DishkoHttpResponse;
  };
  readonly html: {
    /** Parses HTML locally using AngleSharp (no external sub-resource fetches). */
    parse(html: string): DishkoHtmlNode;
  };
  readonly jsonLd: {
    /** Extracts a Schema.org Recipe JSON-LD block into a DishkoRecipeDetail, or returns null. */
    extractRecipe(html: string, sourceUrl?: string): DishkoRecipeDetail | null;
  };
}

/** Registers the recipe source implementation with Dishko's sandbox runtime. */
declare function defineSource(source: DishkoSource): void;

/** Constrained host bridge injected into the sandbox. */
declare const dishko: DishkoHostBridge;
