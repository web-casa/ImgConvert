// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors
import { mount } from "svelte";
import "./app.css";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const pageKind = document.querySelector('meta[name="page-kind"]')?.getAttribute("content");

async function loadPage() {
  if (pageKind === "not-found" || pathname === "/404" || pathname === "/404.html") {
    return (await import("./NotFound.svelte")).default;
  }

  if (pageKind === "guide") {
    return (await import("./Guide.svelte")).default;
  }

  if (pageKind === "resource-hub") {
    return (await import("./ResourceHub.svelte")).default;
  }

  if (pageKind === "resource") {
    return (await import("./ResourcePage.svelte")).default;
  }

  if (pathname === "/privacy" || pathname === "/en/privacy") {
    return (await import("./Privacy.svelte")).default;
  }

  if (pathname === "/legal" || pathname === "/en/legal") {
    return (await import("./Legal.svelte")).default;
  }

  return (await import("./App.svelte")).default;
}

const Page = await loadPage();

const target = document.getElementById("app")!;

// Content entries contain a compact semantic fallback for crawlers and for a failed script load.
// Remove it before mounting the interactive Svelte page so visual content is never duplicated.
target.replaceChildren();

const app = mount(Page, { target });

export default app;
