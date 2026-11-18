# Component derived spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Remove redundant model Design Spec copying for newly versioned image-component references.
**Architecture:** Pure validated derivation in V14, original compiler/resource library, preserve native inheritance and legacy model path.
**Tech Stack:** Node ESM, Zod, existing workflow/checkpoints and PostgreSQL/Chrome tests.
**Spec:** docs/superpowers/specs/2026-11-18-component-derived-spec-design.md

## Global Constraints
- No model calls in this implementation/QA; no candidate churn or old task upgrade.
- Profile/source data unchanged; derived graph clearly labeled, no sharing rights inferred.

## Review Focus
- Unknown marker: reject before cache/model (Task 2).
- Source graph present: never replace it (Tasks 1/2).
- Changed/forged Profile evidence: formal validator rejects (Task 1).
- Existing checkpoint replay: existing stage inputs unchanged (Task 2).
- New admission/retry compatibility and complete resource bind/export: test explicitly (Task 2).

### Task 1: Pure derived declaration
- [ ] Write failing tests for independent page graph, exact Profile, formal validation, no native graph eligibility, no invented styles.
- [ ] Implement component-derived-spec.mjs deriveComponentDesignSpec({profile,scope,fidelity,context}) and eligibility helper.
- [ ] Run tests and commit.

### Task 2: Versioned workflow integration
- [ ] Failing integration tests: four requests vs legacy five, unchanged cache reuse, marker validation and native graph branch.
- [ ] Wire version admission/retention, local-stage derivation and explicit source limitations; adjust estimated stage text only.
- [ ] Run focused/full tests, independent review, real PG/Chrome controlled upload-binding-export QA.
- [ ] Back up and deploy only after review, verify actual served assets and fixed entrance.

## Execution ledger / rulings

- Task 1 complete: f35c47a, 3 tests RED→GREEN. Eligibility conservative known PDF/image/DOCX only; PPTX always keeps model design interpretation even if selection omitted native artifacts. Ruling: source-kind protection supplements graph presence, avoiding accidental degradation from selected-page bundle filtering.
- Task 2 complete: ff7af9a, 27 focused green; independent reviewer reran 27/27 with no blocker. Existing raw checkpoints unchanged and zero extra calls on replay. New no-semantics image path 4 stages; extra semantics path 5.
- Full cloud suite 1008: 936 pass, 56 prior environment/baseline failures, 16 skip. Full log /tmp/derived-full.log. Failures include PG UDS EPERM, Chrome/Poppler cancellation and existing hidden-chat-scroll assertion; not a full-suite success claim.
- Real PostgreSQL/HTTP 42/42 green. Real Chrome synthetic upload → private candidate → pre-review binding rejection → explicit test confirmation → original text binding → geometry check → export without project text passed; no remote model calls, no aesthetic acceptance. First browser run reached export but retained old literal 6-call assertion; corrected to actual 5 in cloud 1aa39c9 and complete rerun passed.
- Deployed CSADI-Linux 21d0a7f with source/dist backup and clean worktree; service active. Actual 4320 conversation-ui hash 64a32cf4c5bc95694dab61e777e8cd235c7ae8f9350addb10ba26bbd81d2e258 matched built bytes; real Chrome loaded new stage/caveat text. No production candidate, source, or project-data modifications.
