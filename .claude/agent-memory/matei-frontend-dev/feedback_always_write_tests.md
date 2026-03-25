---
name: Always write tests for new functionality
description: Every new component, page, or feature must have corresponding tests written alongside it
type: feedback
---

Every new piece of functionality MUST have tests written for it — no exceptions.

**Why:** User explicitly set this as a rule. Missing test coverage was found across 23 files (63% coverage) and the user wants full coverage going forward.

**How to apply:** When adding any new component or page, always create a corresponding test file in the `__tests__` directory. When modifying existing files with new functionality, add tests for the new behavior. Never commit new code without tests.
