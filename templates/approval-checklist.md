# Approval Checklist (external artifacts)

Run this checklist before any artifact is marked `approval_required` → `approved`.
An artifact is external if it will be published, sent to a client or prospect,
or represents Steadymade publicly.

## 1. Source and truth

- [ ] All facts and claims trace to `knowledge/company/` sources or user input
- [ ] No content originates from `knowledge/inbox/` or `knowledge/personal/`
- [ ] No claimed tool executions (exports, API calls, image generation) that did not actually run

## 2. Strategy

- [ ] Strategy Gate applied if required (offers, pricing, positioning, public claims)
- [ ] Consistent with SSOT strategy docs (`knowledge/company/strategy/`)
- [ ] Market scope correct (DACH / Australia / Both)

## 3. Quality

- [ ] Quality rubric (`templates/quality-rubric.md`) score is Pass on every dimension
- [ ] Rosa review done for editorial artifacts

## 4. Compliance and risk

- [ ] No inflated ROI promises, no fake urgency, no AI hype
- [ ] No confidential client data exposed
- [ ] Rhetorical pattern "not A, but B" (and German equivalents) removed

## 5. Approval

- [ ] The user has **explicitly** approved this artifact in this conversation
- [ ] Status set to `approved` only after that explicit approval
- [ ] Run log entry written to `runs/` (see `runs/run-log-template.md`)
