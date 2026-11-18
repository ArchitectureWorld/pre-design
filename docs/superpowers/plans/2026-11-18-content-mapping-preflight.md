# Content mapping preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Reject newly mapped text overflow before writing bindings, without changing existing client requests.
**Architecture:** Shared preview preparation, bounded browser check outside project locks, internal receipt and exact snapshot recheck inside existing save serialization/CAS.
**Tech Stack:** Node ESM, Fastify, existing PostgreSQL library store, Playwright.
**Spec:** docs/superpowers/specs/2026-11-18-content-mapping-preflight-design.md

## Constraints / Review Focus
- No source edits/model calls. No new candidates.
- Snapshot mutation after QA must reject, no writes.
- Same request retry returns saved mutation without duplicate QA; wrong fingerprint rejects.
- No unbounded queue; release on failure/abort/timeout; no browser under lock.
- Existing preview must still support global/local/manual/remove and preserve ownership/material access.
- New QA details identify slot, never leak private source text.

### Task 1: Pure bounded gate and shared page preparation
- [ ] RED tests: QA failure no save; changed identity rejects; successful exact recheck; active admission; cancellation; replay.
- [ ] Implement content-mapping-preflight.mjs gate and layout-preview.mjs shared prepare from existing route.
- [ ] Add stable slotId/binding/width diagnostics to validation; verify no body text.

### Task 2: API/store/UI integration
- [ ] RED tests for preflight on new mapping, idempotent replay, failure no mutation, original draft unchanged.
- [ ] Add read-only matching binding mutation lookup; route checks mapping in gate outside serial and rerenders inside serial before save.
- [ ] UI state says trial then save; failed editor draft preserved.
- [ ] Full/focused tests, independent review, real PG/Chrome, backup deploy and served hashes.
