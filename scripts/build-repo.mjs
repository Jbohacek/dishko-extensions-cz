#!/usr/bin/env node
/**
 * Zero-dependency repo.json generator for community Dishko extension repositories.
 * Reads manifest.template.json, hashes each local scriptFile with SHA-256, and writes repo.json.
 *
 * Usage:
 *   node scripts/build-repo.mjs --base-url https://user.github.io/my-dishko-repo
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

const templatePath = resolve(getArg("--template", "manifest.template.json"));
const outPath = resolve(getArg("--out", "repo.json"));
const baseUrl = getArg("--base-url", "").replace(/\/+$/, "");

if (!/^https?:\/\//i.test(baseUrl)) {
  console.error("Error: --base-url must be an http:// or https:// URL (e.g. https://user.github.io/repo).");
  process.exit(1);
}

const templateDir = dirname(templatePath);
const template = JSON.parse(readFileSync(templatePath, "utf8"));

const extensions = (template.extensions || []).map(ext => {
  const { scriptFile, ...rest } = ext;
  if (!scriptFile) {
    throw new Error(`Extension '${ext.id}' is missing 'scriptFile'.`);
  }

  const normalizedRel = scriptFile.replace(/\\/g, "/").replace(/^\/+/, "");
  const bytes = readFileSync(resolve(templateDir, normalizedRel));
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    ...rest,
    scriptUrl: `${baseUrl}/${normalizedRel}`,
    sha256,
  };
});

const manifest = {
  schemaVersion: template.schemaVersion ?? 1,
  id: template.id,
  name: template.name,
  ...(template.description ? { description: template.description } : {}),
  ...(template.homepage ? { homepage: template.homepage } : {}),
  extensions,
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${outPath} with ${extensions.length} extension(s).`);
