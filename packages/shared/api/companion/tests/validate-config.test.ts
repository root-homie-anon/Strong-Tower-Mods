/**
 * Startup-config validation tests.
 *
 * Both validateAuthConfig and validateAnthropicConfig are pure
 * env-driven functions that return a boolean — no DB, no Fastify, no
 * subprocesses. We exercise the dangerous combinations explicitly so a
 * future refactor cannot accidentally remove the production guard
 * without a failing test.
 *
 * Why these exist: prior to this commit, AUTH_MOCK=true with
 * NODE_ENV=production was a silent full-auth bypass — the comment in
 * auth.ts explicitly opted out of the guard pattern used by Anthropic
 * and Stripe. That was wrong. These tests are the regression net.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { validateAuthConfig } from '../src/auth.js';
import { validateAnthropicConfig } from '../src/claude.js';

const ORIGINAL_AUTH_MOCK = process.env['AUTH_MOCK'];
const ORIGINAL_ANTHROPIC_MOCK = process.env['ANTHROPIC_MOCK'];
const ORIGINAL_NODE_ENV = process.env['NODE_ENV'];
const ORIGINAL_ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];

beforeEach(() => {
  delete process.env['AUTH_MOCK'];
  delete process.env['ANTHROPIC_MOCK'];
  delete process.env['NODE_ENV'];
  delete process.env['ANTHROPIC_API_KEY'];
});

afterAll(() => {
  // Restore whatever the surrounding test runner had — these env
  // vars are global state and other suites in the same process
  // would be poisoned by a stale value.
  if (ORIGINAL_AUTH_MOCK !== undefined) process.env['AUTH_MOCK'] = ORIGINAL_AUTH_MOCK;
  if (ORIGINAL_ANTHROPIC_MOCK !== undefined) process.env['ANTHROPIC_MOCK'] = ORIGINAL_ANTHROPIC_MOCK;
  if (ORIGINAL_NODE_ENV !== undefined) process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ANTHROPIC_API_KEY !== undefined) {
    process.env['ANTHROPIC_API_KEY'] = ORIGINAL_ANTHROPIC_API_KEY;
  }
});

describe('validateAuthConfig', () => {
  test('passes when AUTH_MOCK is unset', () => {
    expect(validateAuthConfig()).toBe(true);
  });

  test('passes when AUTH_MOCK=true and NODE_ENV is not production (dev/test default)', () => {
    process.env['AUTH_MOCK'] = 'true';
    expect(validateAuthConfig()).toBe(true);
  });

  test('passes when AUTH_MOCK=true and NODE_ENV=test', () => {
    process.env['AUTH_MOCK'] = 'true';
    process.env['NODE_ENV'] = 'test';
    expect(validateAuthConfig()).toBe(true);
  });

  test('REFUSES TO BOOT when AUTH_MOCK=true and NODE_ENV=production', () => {
    process.env['AUTH_MOCK'] = 'true';
    process.env['NODE_ENV'] = 'production';
    expect(validateAuthConfig()).toBe(false);
  });

  test('passes when NODE_ENV=production and AUTH_MOCK is unset', () => {
    process.env['NODE_ENV'] = 'production';
    expect(validateAuthConfig()).toBe(true);
  });
});

describe('validateAnthropicConfig', () => {
  test('passes when ANTHROPIC_MOCK=true and NODE_ENV is not production', () => {
    process.env['ANTHROPIC_MOCK'] = 'true';
    expect(validateAnthropicConfig()).toBe(true);
  });

  test('REFUSES TO BOOT when ANTHROPIC_MOCK=true and NODE_ENV=production', () => {
    process.env['ANTHROPIC_MOCK'] = 'true';
    process.env['NODE_ENV'] = 'production';
    expect(validateAnthropicConfig()).toBe(false);
  });

  test('REFUSES TO BOOT when ANTHROPIC_MOCK is unset and ANTHROPIC_API_KEY is missing', () => {
    expect(validateAnthropicConfig()).toBe(false);
  });

  test('passes in production when ANTHROPIC_API_KEY is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    expect(validateAnthropicConfig()).toBe(true);
  });
});
