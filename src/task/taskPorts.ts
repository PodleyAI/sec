/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bridges a domain `interface` to the task-graph `DataPorts` constraint.
 * Interfaces carry no implicit index signature, so `Task<In, SomeInterface>`
 * fails to typecheck even when the shape is a perfectly good port record; a
 * homomorphic mapped type is structurally identical but gains the implicit
 * index signature. Purely type-level — no runtime cost.
 */
export type TaskPorts<T> = { [K in keyof T]: T[K] };
