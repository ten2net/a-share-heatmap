import { readFile, writeFile } from "node:fs/promises";

const supporters = JSON.parse(await readFile(new URL("../src/lib/data/supporters.json", import.meta.url), "utf8"));
const readmeUrl = new URL("../README.md", import.meta.url);
const readme = await readFile(readmeUrl, "utf8");
const newline = readme.includes("\r\n") ? "\r\n" : "\n";
const section = /<!-- supporters:start -->[\s\S]*?<!-- supporters:end -->/;
if (!section.test(readme)) {
  throw new Error("README is missing the supporters section markers.");
}
const list = [
  "<!-- supporters:start -->",
  "",
  ...supporters.map(({ name, url }) => url ? `- [${name}](${url})` : `- ${name}`),
  "",
  "<!-- supporters:end -->",
].join(newline);
await writeFile(readmeUrl, readme.replace(section, () => list));
console.log("Synced supporters to README.md");
