/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SEC fair-access policy requires a User-Agent in the form
 *   "Sample Company Name AdminContact@samplecompany.com"
 * EDGAR has been observed to 403 on RFC-5322 angle-bracket forms.
 * Override at runtime via the SEC_USER_AGENT environment variable so each
 * deployer identifies themselves rather than masquerading as the default.
 */
const DEFAULT_SEC_USER_AGENT = "PodleyAI SEC Job Queue sroussey@gmail.com";
export const SecUserAgent = process.env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_USER_AGENT;
export const SecJobQueueName = "sec_job_queue";

/**
 * General default model id shared by every SEC AI extractor (S-1, merger-proxy,
 * redemption) when its own env override (e.g. SEC_S1_MODEL) is unset. Override
 * for all extractors at once via the SEC_MODEL_DEFAULT environment variable.
 */
const DEFAULT_SEC_MODEL = "claude-sonnet-5";
export const SecModelDefault = process.env.SEC_MODEL_DEFAULT?.trim() || DEFAULT_SEC_MODEL;
