import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const reportOnly = process.argv.includes("--report-only");
const noticeUrl = new URL("../node_modules/@imagemagick/magick-wasm/NOTICE", import.meta.url);
const notice = await readFile(noticeUrl, "utf8");
const sections = notice.split(/(?=^\[ .+ \]$)/m).filter((section) => section.startsWith("[ "));

const deniedLicenses = [
  { license: "AGPL", marker: "GNU AFFERO GENERAL PUBLIC LICENSE" },
  { license: "LGPL", marker: "GNU LESSER GENERAL PUBLIC LICENSE" },
  { license: "GPL", marker: "GNU GENERAL PUBLIC LICENSE" },
];

const components = sections.map((section) => {
  const [heading = "[ unknown ]"] = section.split("\n", 1);
  const deniedLicense = deniedLicenses.find(({ marker }) => section.includes(marker));
  return {
    component: heading.slice(2, -2),
    deniedLicense: deniedLicense?.license,
  };
});

const violations = components.filter(({ deniedLicense }) => deniedLicense !== undefined);
const report = {
  compatibleWithImgConvertPolicy: violations.length === 0,
  inspectedNotice: fileURLToPath(noticeUrl),
  packagedComponents: components.map(({ component }) => component),
  violations,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (violations.length > 0 && !reportOnly) {
  process.stderr.write(
    "Bundled WASM components violate ImgConvert's no-AGPL/GPL/LGPL dependency policy.\n",
  );
  process.exitCode = 1;
}
