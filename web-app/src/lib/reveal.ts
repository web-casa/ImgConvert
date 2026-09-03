// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

/**
 * IntersectionObserver 入场动作:元素进入视口时加 reveal-in 类
 * (translateY(12px) + fade,时长/缓动由各变体 CSS 定义),可用 delay 做 stagger。
 * 尊重 prefers-reduced-motion:直接终态,不加监听。
 */

import type { Action } from "svelte/action";

interface RevealParams {
  readonly delay?: number;
}

export const reveal: Action<HTMLElement, RevealParams | undefined> = (node, params) => {
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof IntersectionObserver === "undefined"
  )
    return;
  const delay = params?.delay ?? 0;
  node.classList.add("reveal-init");
  if (delay > 0) node.style.transitionDelay = `${delay}ms`;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        node.classList.add("reveal-in");
        observer.disconnect();
      }
    },
    { threshold: 0.05 },
  );
  observer.observe(node);
  return {
    destroy() {
      observer.disconnect();
      node.classList.remove("reveal-init", "reveal-in");
      node.style.transitionDelay = "";
    },
  };
};
