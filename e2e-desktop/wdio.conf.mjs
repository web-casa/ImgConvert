// SPDX-License-Identifier: Apache-2.0
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const sessionRoot = mkdtempSync(path.join(os.tmpdir(), "imgconvert-desktop-e2e-"));
const input = path.join(sessionRoot, "fixture.png");
const pdfInput = path.join(sessionRoot, "document.pdf");
const outDir = path.join(sessionRoot, "output");
const configDir = path.join(sessionRoot, "config");
mkdirSync(outDir);
mkdirSync(configDir);
copyFileSync(path.resolve("public/favicon.png"), input);
writeFileSync(pdfInput, minimalPdf(2));

process.env.IMGCONVERT_DESKTOP_E2E_INPUT = input;
process.env.IMGCONVERT_DESKTOP_E2E_PDF_INPUT = pdfInput;
process.env.IMGCONVERT_DESKTOP_E2E_OUT_DIR = outDir;
process.env.IMGCONVERT_ENABLE_DESKTOP_E2E = "1";
process.env.XDG_CONFIG_HOME = configDir;
process.env.LANG = "en_US.UTF-8";
process.env.IMGCONVERT_DESKTOP_E2E_SESSION_ROOT = sessionRoot;

let tauriDriver;
let shuttingDown = false;

export const config = {
  host: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.mjs"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: path.resolve("src-tauri/target/debug/imgconvert"),
      },
    },
  ],
  reporters: ["spec"],
  logLevel: "warn",
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  beforeSession() {
    const driver =
      process.env.TAURI_DRIVER_PATH ?? path.join(os.homedir(), ".cargo/bin/tauri-driver");
    tauriDriver = spawn(driver, [], { stdio: ["ignore", "inherit", "inherit"], env: process.env });
    tauriDriver.on("error", (error) => {
      console.error("tauri-driver failed to start:", error);
      process.exitCode = 1;
    });
    tauriDriver.on("exit", (code) => {
      if (!shuttingDown && code !== 0) {
        console.error(`tauri-driver exited unexpectedly with code ${code}`);
        process.exitCode = 1;
      }
    });
  },
  afterSession() {
    closeDriver();
  },
  onComplete() {
    closeDriver();
    if (path.basename(sessionRoot).startsWith("imgconvert-desktop-e2e-")) {
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  },
};

function closeDriver() {
  shuttingDown = true;
  tauriDriver?.kill();
  tauriDriver = undefined;
}

function minimalPdf(pageCount) {
  const firstContentId = 3 + pageCount;
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
  ];
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents ${firstContentId + index} 0 R >>`,
    );
  }
  for (let index = 0; index < pageCount; index += 1) {
    const stream =
      index % 2 === 0 ? "q 1 0 0 rg 0 0 72 72 re f Q\n" : "q 0 0 1 rg 0 0 72 72 re f Q\n";
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }

  let document = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, "latin1"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document, "latin1");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document, "latin1");
}
