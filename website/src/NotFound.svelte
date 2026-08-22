<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";

  const english = window.location.pathname.startsWith("/en");
  const copy = english
    ? {
        label: "404 · PAGE NOT FOUND",
        title: "This page\nis not here.",
        body: "Try the ImgConvert homepage for local image conversion, batch compression, and downloads.",
        action: "Back to home",
        home: "/en/",
      }
    : {
        label: "404 · PAGE NOT FOUND",
        title: "这个页面\n不在这里。",
        body: "请回到 ImgConvert 首页，查看本地图片转换、批量压缩和下载信息。",
        action: "回到首页",
        home: "/",
      };

  document.title = english ? "Page not found | ImgConvert" : "页面未找到 | ImgConvert";
</script>

<main class="not-found">
  <a class="brand" href={copy.home} aria-label="ImgConvert home">
    <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="brand-name">ImgConvert</span>
  </a>
  <div>
    <p class="eyebrow">{copy.label}</p>
    <h1>{copy.title}</h1>
    <p>{copy.body}</p>
    <a class="button button-primary" href={copy.home}>
      <ArrowLeft size={17} strokeWidth={2.1} aria-hidden="true" />{copy.action}
    </a>
  </div>
</main>
