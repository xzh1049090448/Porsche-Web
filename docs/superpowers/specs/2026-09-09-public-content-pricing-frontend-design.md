# Public Content and Pricing Frontend Design

**Status:** APPROVED_FOR_PLANNING  
**Date:** 2026-09-09  
**Scope:** PRD-260903 P01 and P03-P08 frontend and renderer surfaces

## Product and contract boundary

The backend design in the Porsche repository is the canonical persistence, authorization, scheduler, API, and failure contract. This frontend implements the public site, Root-only pricing administration, notifications, content workflow, and snapshot renderer client without local pricing truth. Prices remain USD reference prices per million input or output tokens and never imply automatic billing.

The first release uses a safe draft. The UI must not fall back to prototype model counts, guarantees, licenses, legal text, or prices when reviewed publication data is absent.

## Routes and layouts

`PublicLayout` owns `/`, `/pricing`, `/pricing/:modelKey`, `/about`, `/terms`, `/privacy`, and a real public 404. `MainLayout` owns `/chat`, existing account pages, user management, Root pricing administration, content administration, and notifications. `/` becomes the public homepage and the previous chat route becomes `/chat`. Successful login defaults to `/chat`; redirect handling rejects absolute, protocol-relative, encoded-external, and otherwise unsafe targets.

Public routes load only the public shell and page modules so visitors do not download management features. Logged-in visitors still see the public homepage and use “进入控制台” to open `/chat`.

## Public pages

Visuals follow PRD section 7 and the landing/pricing prototypes: `#2563EB` primary, `#1D4ED8` hover, `#EFF6FF` pale blue, `#F8FAFC` public background, white cards with 16px radius, readable text contrast, system Chinese/Inter typography, and monospace model identifiers/prices.

Homepage order is fixed header, two-column hero, advantages, published model wall, announcements/FAQ, CTA, and footer. Missing links are omitted instead of rendered as `#`. Demonstration content is explicitly labelled and cannot masquerade as usage evidence.

Pricing uses a 260px desktop filter beside toolbar/table/pagination and a mobile filter drawer plus cards. Search, provider, capability, endpoint, sorting, and pagination remain in the URL. Only comparable USD/million-token input and output values are sortable. Missing values display “价格未发布”, never zero. Every page displays the reference-price disclaimer.

Model detail routes use stable `modelKey`; upstream IDs containing `/` are display data only. Unknown/unpublished keys show 404, while previously published inactive/deleted keys show 410 with a delisting explanation. About/terms/privacy render only published content with visible version/effective date where applicable.

## Root pricing administration

The Root-only area contains:

- model list/search with lifecycle, completeness, and upstream-state filters;
- detail/create/update forms for public metadata and fixed USD input/output prices;
- activate, inactivate, and non-recoverable soft-delete actions;
- missing-model detection split into upstream-unconfigured and configured-upstream-missing sets;
- draft-versus-live snapshot differences, validation, explicit publication, history, and restoration;
- notification inbox, unread count, read, and acknowledgement state.

Creation starts from a recently observed upstream model. The UI does not allow arbitrary upstream IDs, changing `modelKey`, currency/unit choice, per-request prices, deleted-item browsing, or restoration after delete. Writes submit `expected_revision`; `409` shows a refresh/compare flow and never silently overwrites.

Price publication and restoration use current-password action verification, a single-use ticket, and an idempotency key. Upstream auto-inactivation is shown as system activity. A reappearing model remains inactive until Root reviews and activates it.

## Public content administration

Site, homepage, about, terms, and privacy editing uses versioned drafts. Preview is authenticated, `no-store`, and `noindex`. Publish validation shows exact blockers for missing review, unsafe content, broken model references, or version conflicts. Historical restoration creates a new version. Model pricing remains Root-only even if later content permissions are delegated.

Restricted Markdown rendering uses the existing sanitization path strengthened to reject executable URLs, event attributes, arbitrary embeds, and remote image fetching. Only controlled local/approved assets render.

## Notifications

The authenticated header shows a Root-only unread badge. The inbox groups active and resolved alerts for price below upstream, missing/auto-inactivated/reappeared models, catalog failures, incomparable prices, and renderer failures. Each Root independently marks read or acknowledged. The client knows only the `in_app` channel; email delivery is a documented follow-up and has no fake toggle.

## Static renderer

The repository provides a `public-renderer` entrypoint that polls committed render generations at least once per minute, reads only public APIs, produces meaningful HTML plus `sitemap.xml` in a private stage directory, validates release/version/redaction invariants, and atomically switches the published directory. A failed generation preserves the last-good tree.

Generated public HTML contains published title, description, canonical URL, visible content, and the Vue handoff. Authenticated-only prices are absent from HTML and sitemap. `restart-all.sh` installs and restarts the renderer process; a content publication does not require an application redeploy.

## Responsive and accessible behavior

At 375px filters use a drawer, price rows use cards, dialogs fit the viewport, and dangerous actions remain labelled in an overflow menu. At 768px and 1440px hierarchy and table density follow the PRD. Keyboard navigation, visible focus, semantic headings, text-plus-color statuses, reduced motion, and accessible dialog focus are release gates.

## Failure states

Public pages distinguish loading, empty publication, empty search, network failure, 404, and 410. They never substitute prototype data. Administration distinguishes validation failure, stale revision, action-ticket failure, duplicate publication result, upstream stale/error state, and renderer failure. Current published content remains visible whenever a draft, publication, or rendering operation fails.

## Verification

Unit/contract tests cover route boundaries, safe redirects, public DTO mapping, price formatting and missing values, URL filters, stable keys, 404/410, Root-only navigation and direct access, model lifecycle forms, missing detection, optimistic conflicts, publication/history, notifications, and sanitization. Browser acceptance covers anonymous pages, refresh/share routes, Root administration, publication failure preserving the old version, 375/768/1440 layouts, keyboard/focus, and API/HTML/sitemap version agreement.

P01 and P03-P08 retain separate evidence. Code completion does not claim approved production content while safe drafts still lack reviewed prices, terms, privacy, or brand copy.

## Deferred work

- Email notification delivery and SMTP/recipient configuration.
- Real ledger billing, currency conversion, token charging, or payments.
- Deleted-model browsing/restoration.
- Per-request pricing and non-USD units.

