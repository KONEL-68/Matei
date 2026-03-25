---
name: Always update CHANGELOG.md and CLAUDE.md
description: Every commit must update CHANGELOG.md and CLAUDE.md to reflect changes made
type: feedback
---

After every change, ALWAYS update both CHANGELOG.md and CLAUDE.md before committing.

**Why:** User requires docs to stay in sync with code at all times. Stale docs cause confusion.

**How to apply:**
- CHANGELOG.md: Add entries under `## [Unreleased]` in the appropriate section (Added/Changed/Fixed/Removed). Follow Keep a Changelog format.
- CLAUDE.md: Update if you added new components to the component list in project structure, or changed any documented behavior.
- Do this BEFORE committing, not as a separate step.
