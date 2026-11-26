# dishko-extensions-cz

Repozitář [Dishko](https://github.com/Jbohacek/Dishko) rozšíření (`apiVersion: 1`) pro české receptové weby.

**Přidání do Dishka:** *Nastavení › Zdroje receptů › Přidat repozitář* →

```
https://jbohacek.github.io/dishko-extensions-cz/repo.json
```

## Rozšíření

| ID | Web | Výpis | Hledání | Filtry | Detail / Import z URL | Jak to funguje |
| --- | --- | :-: | :-: | :-: | :-: | --- |
| `cz.fresh-iprima` | [Prima Fresh](https://fresh.iprima.cz) | ✅ | ✅ | 16 kategorií | ✅ | HTML snippety `/_snippet/…` + Schema.org JSON-LD, skupiny surovin a porce z HTML |
| `cz.toprecepty` | [TopRecepty.cz](https://www.toprecepty.cz) | ✅ | ✅ | 25 kategorií | ✅ | HTML výpis + JSON-LD (nadpisy typu „Na zahuštění:" → `groupName`) |
| `cz.milujivareni` | [Miluji vaření](https://www.milujivareni.cz) | ✅ | ✅ | 25 kategorií + řazení | ✅ | Next.js `__NEXT_DATA__` (výpis/hledání) + JSON-LD, skupiny surovin z `recipeIngredientGroups` |
| `cz.apetitonline` | [Apetit](https://www.apetitonline.cz) | ✅ | ❌ | 33 kategorií | ✅ | Drupal HTML výpis + JSON-LD, skupiny surovin („K podávání") z HTML |
| `cz.primainspirace` | [Prima Inspirace](https://primainspirace.cz) | ✅ | ✅ | 13 kategorií | ✅ | Veřejné WordPress REST API, recept parsovaný z obsahu článku |

### Známá omezení

- **Recepty na každý den (receptynakazdyden.cz) – není zahrnuto.** Celý web (včetně `robots.txt` a `sitemap.xml`) je za Akamai Bot Managerem, který vrací `403 Access Denied` každému klientovi, který není prohlížeč. Dishko používá obyčejný `HttpClient` bez JavaScriptu, takže web nejde čistě načíst a ochranu obcházet nechceme.
- **Apetit – bez hledání.** Stránka `/vyhledavani` je za Cloudflare ochranou, která ne-prohlížečové klienty blokuje (`403`). Výpis, kategorie i detail (a tím i *Import z URL*) fungují.
- **Prima Fresh – videorecepty** (`/videorecepty/…`) mají na webu jen seznam surovin bez množství a postup jen ve videu. Detail je vrátí s poznámkou a odkazem na video. Z hledání se vynechávají magazínové články (`/magazin/…`).
- **Prima Inspirace – souhrnné články** („14 receptů na guláš") nemají vlastní suroviny ani postup; detail vrátí jen název a odkaz. Počet porcí web většinou neuvádí (Dishko použije výchozí 4).
- **Miluji vaření – nefiltrovaný výpis** `/top-recepty` má kvůli vloženému stromu kategorií ~1,9 MB, tedy těsně pod limitem sandboxu (2 MB). Pokud by web stránku zvětšil, výpis „Vše" přestane fungovat – kategorie (~1,3 MB) a hledání (~170 kB) mají rezervu.

## Struktura

```text
├── AGENTS.md                    # instrukce pro AI agenty (pravidla sandboxu, workflow)
├── manifest.template.json       # zdroj pravdy – metadata + seznam rozšíření (bez hashů)
├── repo.json                    # generovaný katalog (scriptUrl + sha256)
├── extensions/                  # jeden samostatný .js soubor na web
├── types/dishko-extension.d.ts  # typy pro autocomplete v editoru
├── scripts/build-repo.mjs       # manifest.template.json -> repo.json
└── .github/workflows/publish-repo.yml  # publikace na GitHub Pages
```

## Vývoj a testování

Testuje se v reálném Dishko sandboxu (Jint + AngleSharp + SSRF guard) přes `Dishko.ExtensionCli` z checkoutu Dishka:

```powershell
dotnet run --project ..\Dishko\tools\Dishko.ExtensionCli -- run extensions\cz.toprecepty.js --domains www.toprecepty.cz,toprecepty.cz popular 1
```

```powershell
dotnet run --project ..\Dishko\tools\Dishko.ExtensionCli -- run extensions\cz.toprecepty.js --domains www.toprecepty.cz,toprecepty.cz search "guláš" 1
```

```powershell
dotnet run --project ..\Dishko\tools\Dishko.ExtensionCli -- run extensions\cz.toprecepty.js --domains www.toprecepty.cz,toprecepty.cz detail "https://www.toprecepty.cz/recept/38145-segedinsky-gulas/" --parse-ingredients
```

Filtr se předává přes `--filter category=16-polevky`.

Po každé změně skriptu **zvyšte `version`** v `manifest.template.json` a přegenerujte a ověřte katalog:

```powershell
node scripts/build-repo.mjs --base-url https://jbohacek.github.io/dishko-extensions-cz
```

```powershell
dotnet run --project ..\Dishko\tools\Dishko.ExtensionCli -- validate repo.json --scripts-dir .
```

## Publikace

Push do `main` spustí workflow `.github/workflows/publish-repo.yml`, které vygeneruje `repo.json` s hashi a nasadí ho spolu s `extensions/*.js` na GitHub Pages. V nastavení repozitáře je potřeba mít **Settings › Pages › Source: GitHub Actions**.

Specifikace: [`goal/extensions-spec.md`](goal/extensions-spec.md), průvodce pro AI: [`goal/extensions-ai-guide.md`](goal/extensions-ai-guide.md).
