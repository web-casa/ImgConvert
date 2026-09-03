// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

/**
 * 区域组件共享类型:App.svelte 持有全部 state 与事件处理,
 * 通过 props/回调下发给各区域组件。
 */

import type { translations } from "./copy";
import type { QueueFailure } from "./queue";

export type Theme = "dark" | "light";
export type Copy = (typeof translations)["en"];

export interface AdmissionNotice {
  readonly failure: QueueFailure;
  readonly id: string;
  readonly name: string;
}
