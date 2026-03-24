# Agent.MD — chord-sheet-maker

Last updated: 2026-03-24

## Repo role

This repo is the **normalizer / converter workbench**.

Primary responsibilities:
- ingest structured notation formats
- normalize source material into stable internal representations
- convert MusicXML / MXL / related source into ChordPro / CSMP-oriented output
- serve as the safer place to mature new parsing and conversion logic before it is depended on by the Pro finishing app

## Confirmed current strengths

- MusicXML / MXL handling is a strong use case here
- This repo successfully helped normalize complex notation like "Confirmation"
- It solved XML rendering/conversion problems that were difficult in the main Pro app
- The converter role is already proving useful in the real user workflow

## Strategic direction agreed in session

This repo should remain focused on **ingestion and normalization**, not final fake-book presentation.

It is the right place for:
- MusicXML / MXL parsing improvements
- structural conversion experiments
- diagnostics and normalization logic
- future shared parser work that may later feed CSMPN more reliably

## Relationship to chord-sheet-maker-pro

Recommended division of labor:

### This repo
- converter / parser / normalizer
- structured-format handling
- ingestion experiments
- format bridge work

### chord-sheet-maker-pro
- final fake-book presentation
- Power Mode adjustments
- layout tuning
- gig-ready print/PDF/PNG output

This separation is now validated by the real-world "Confirmation" workflow.

## Highest-value future work

Although this repo is strongest with structured notation, it may also become the best place to prototype the next major upgrade:

### Unified semi-structured parser
Target inputs:
- UG text
- chord-over-lyrics text
- chord-over-measure text
- chord dumps
- plain copied web text
- PDF-extracted text after cleanup

Goal:
- classify line roles
- extract chords and sections
- infer measure grouping
- emit cleaner normalized output for downstream CSMPN use

## Why this matters

The broader project no longer mainly needs "more import buttons."
It needs a smarter and more unified **text understanding layer**.

That layer should likely be developed here first, where parser quality can improve without destabilizing the finishing app.

## Mobile / practical workflow note

The user is primarily working on:
- iPhone iOS
- iPad / tablet iOS
- no full console/dashboard workflow yet

So successful work must surface in visible outcomes, practical exports, and converter reliability — not just code-level claims.

## Guardrails

- Keep converter responsibilities clear
- Avoid duplicating presentation-layer concerns that belong in Pro
- Favor reusable parser components over format-by-format ad hoc logic
- Build normalization primitives that can later be shared with Pro if needed

## Next implementation priorities

1. Keep MusicXML / MXL path stable
2. Document normalization responsibilities clearly
3. Prototype unified text / UG structural parsing here where practical
4. Feed successful normalized output into Pro instead of overloading Pro with every conversion concern
5. Continue updating Agent.MD after meaningful sessions/tasks

## Resume point for next session

Use this repo as the likely prototype space for the next parsing upgrade, while preserving its existing role as the XML/MXL normalizer that already solved real conversion issues in practice.
