# AGENTS.md

# DueDiligence.ph Engineering Constitution

This document defines the engineering standards for every AI agent or developer working on this project.

These rules are permanent.

They take precedence over convenience, speed, or unnecessary experimentation.

---

# Mission

Build the most trusted AI-assisted Philippine Bar Examination Essay Review Platform.

Every engineering decision must increase one or more of the following:

* Accuracy
* Reliability
* Maintainability
* Performance
* Security
* User Experience

If a proposed solution does not improve the product, do not implement it.

---

# Engineering Philosophy

Treat this project as production software.

Never write prototype-quality code.

Never write temporary solutions unless explicitly requested.

Every implementation should be production-ready.

Every change should leave the codebase better than it was before.

---

# Standard of Excellence

Do not settle for code that merely works.

Deliver code that is:

* Elegant
* Readable
* Maintainable
* Modular
* Efficient
* Well-structured

Prefer excellence over shortcuts.

Prefer clarity over cleverness.

Prefer simplicity over unnecessary complexity.

---

# Simplicity

Less is more.

The simplest correct solution is usually the best solution.

Do not introduce new libraries, frameworks, abstractions, or files unless they provide clear long-term value.

Avoid overengineering.

Avoid premature optimization.

Avoid unnecessary code.

---

# Repository First

Before making any change:

Understand the existing architecture.

Understand why the code was written that way.

Respect existing working functionality.

Improve the system instead of replacing it.

Never perform large rewrites unless they are technically justified.

---

# Quality Before Speed

Speed is valuable.

Quality is mandatory.

Never sacrifice architecture simply to finish faster.

Never accept technical debt when a clean solution is reasonably achievable.

Every feature should be implemented as if it will remain in production for years.

---

# AI Responsibilities

Own the assigned task from start to finish.

Your responsibilities include:

* understanding the repository
* planning the implementation
* writing code
* testing
* debugging
* improving
* documenting when necessary
* committing changes
* deploying when authorized by the project workflow

Do not stop at code generation.

Deliver completed engineering work.

---

# Code Standards

Every modification should improve the overall codebase.

Avoid duplication.

Prefer reusable components.

Keep functions focused.

Keep modules cohesive.

Write code that another senior engineer would immediately understand.

If a simpler implementation exists with equal quality, choose the simpler implementation.

---

# Testing

Assume nothing.

Verify everything.

Run all available tests.

Fix failures before considering the task complete.

Never knowingly leave the repository in a broken state.

---

# Deployment

Never deploy code that you would not confidently use in production.

Verify:

* successful build
* passing tests
* working application
* no obvious regressions

Quality is more important than release speed.

---

# Security

Never expose secrets.

Never commit credentials.

Protect user data.

Validate user input.

Follow secure engineering practices by default.

---

# AI Accuracy

AI is an educational assistant.

It is not the legal authority.

The application's curated legal database is always the source of truth.

Never fabricate:

* jurisprudence
* doctrines
* legal citations
* quotations
* legal authorities

If reliable information is unavailable, clearly state the limitation.

---

# Decision Framework

When choosing between multiple solutions, prioritize them in this order:

1. Correctness
2. Legal accuracy
3. Reliability
4. Maintainability
5. Simplicity
6. Performance
7. Development speed

---

# Continuous Improvement

Leave the codebase cleaner than you found it.

Reduce complexity whenever possible.

Refactor only when it provides measurable long-term benefit.

Every commit should move the project closer to production.

---

# Guiding Principle

Do not ask:

"Does this work?"

Ask:

"Is this the best implementation that is practical for this project?"

If the answer is no, improve it.

Build software with craftsmanship.

The reputation of DueDiligence.ph depends on the quality of every line of code.
