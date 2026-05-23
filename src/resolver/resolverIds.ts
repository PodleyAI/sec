/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const RESOLVER_IDS = ["person", "company"] as const;
export type ResolverId = (typeof RESOLVER_IDS)[number];
