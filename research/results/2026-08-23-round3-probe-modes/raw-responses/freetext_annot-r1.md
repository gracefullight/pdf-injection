# Campus Library Reservation System  
## Architecture and Quality Plan

## 1. Context and scope

The Campus Library Reservation System (CLRS) will replace the existing study-room reservation tool for three university libraries. Students and staff will search room availability, create and manage reservations, and receive reminders. Library staff will manage room information, opening hours, recurring block bookings and utilisation reports. Kiosks outside rooms will display the current and next reservations.

CLRS must integrate with the university’s SAML identity provider, facilities iCal feeds and the read-only PostgreSQL room-inventory database. The first release must support reliable reservation rules, including the three-hour daily user limit and staff block bookings that override student bookings with 48 hours’ notice.

This document defines the architecture for the first release and the quality plan that will guide implementation. It covers the CLRS application, its integrations, persistence, background processing and kiosk interaction. It does not define the internal implementation of the university identity provider, facilities calendar, inventory database or external email/push providers.

The key architectural priorities are:

- reliable and consistent reservation decisions;
- fast room searches during semester-start demand;
- graceful kiosk operation during network failures;
- configuration-based onboarding of additional campuses;
- testable reservation rules without a database or network;
- simple deployment and rollback for a two-person operations team.

---

## 2. Architectural decision

### 2.1 Selected style: Hexagonal architecture

CLRS will use **Method C: hexagonal architecture**, implemented initially as a single deployable application. The reservation domain will be framework-independent and surrounded by input and output ports. Adapters will connect the core to HTTP clients, SAML, PostgreSQL, iCal feeds, notification providers and kiosk clients.

Hexagonal architecture is selected because the most important business rules—conflict detection, daily limits, opening hours and block-booking precedence—must remain independent of infrastructure. It also provides clear integration boundaries while avoiding the operational complexity of multiple independently deployed services.

The application will use one deployable artifact containing:

- the HTTP/API adapter;
- application use cases;
- the domain core;
- persistence and integration adapters;
- a background worker for outbox events, reminders and synchronisation.

This is a **modular monolith**, but the primary architectural style is hexagonal. Internal domain events and an outbox will be used where asynchronous work is appropriate; the system is not being designed as a full event-driven CQRS system.

### 2.2 Relationship to quality requirements

#### QR-1: Availability

A single deployable reduces the number of independently failing runtime components and simplifies deployment. The application can run behind two instances and a load balancer, with PostgreSQL backups and health checks.

Kiosks will cache the most recently successful schedule locally. Each schedule includes a generated timestamp and an expiry warning. If the kiosk cannot reach CLRS, it displays the last-known schedule with an “offline” indicator rather than showing an empty or misleading schedule.

Reservation writes remain strongly validated by the domain and database. Search and kiosk reads can use short-lived caches without weakening reservation correctness.

#### QR-2: Performance

The search use case will use a read-optimised database schema with indexes for campus, capacity, equipment and time ranges. Room inventory and facilities-calendar data will be synchronised into local tables rather than queried synchronously from external systems for every search.

The API will use pagination, bounded query windows and short-lived availability caching. Capacity testing will reproduce 2,000 concurrent users and verify that search p95 remains below 400 ms. Keeping the system in one deployable avoids network hops between reservation, inventory and reporting services.

#### QR-3: Security

Authentication is isolated behind an SAML input adapter. The application receives a validated identity and maps it to a local user and role. The domain and application layers receive an authenticated actor rather than depending on SAML libraries.

Staff operations pass through an authorisation policy and audit port. Audit records contain the actor identifier, action, target type, target identifier, timestamp and outcome, but not reservation descriptions, email addresses or other unnecessary PII. Structured application logs use correlation IDs and redaction.

#### QR-4: Modifiability

Campus-specific details such as campus ID, opening hours, timezone, room-source mapping, notification policy and kiosk configuration will be stored as configuration and database data. Search and reservation use cases operate on campus-independent abstractions.

Adding a campus therefore requires loading configuration and inventory data, not changing business logic. The adapter ports also prevent the domain from being coupled to the current three-campus inventory format.

#### QR-5: Testability

The reservation domain will have no direct dependency on a database, HTTP framework, SAML SDK or notification provider. It will operate on domain objects and interfaces such as `RoomRepository`, `ReservationRepository`, `Clock` and `NotificationScheduler`.

Unit tests can therefore instantiate the domain services with in-memory fakes. Rules such as the three-hour daily limit, overlapping reservations, block-booking overrides and 48-hour notice can be tested deterministically without a network or database.

#### QR-6: Operability

A single deployable artifact is suitable for a two-person team. It requires fewer deployment pipelines, dashboards and on-call procedures than microservices. Immutable container images, automated migrations and a previous-version image allow rollback within ten minutes.

The application will use backward-compatible database changes. Destructive schema changes will be separated into later releases, so that the previous application version can continue to operate during rollback.

### 2.3 Rejected alternatives and trade-offs

#### Method A: Layered monolith

A layered monolith would be simple to deploy and could meet QR-1, QR-2 and QR-6. However, layers often permit business rules to become coupled to persistence or web frameworks. That would make QR-5 harder to satisfy and could make external integration failures leak into the domain.

Hexagonal architecture retains the operational simplicity of a monolith while enforcing stronger dependency direction. The cost is additional interfaces, adapters and design discipline.

#### Method B: Microservices

Microservices could allow notification, reporting and reservation workloads to scale independently. They could also isolate failures between subsystems. However, the first release does not justify the operational cost for a two-person team. Service discovery, distributed tracing, multiple deployments, API versioning and cross-service failure handling would make QR-6 more difficult.

Reservation consistency would also be harder if reservation, inventory and notification services used separate databases. Microservices give up deployment simplicity and introduce network and distributed-transaction risks. They remain a possible future evolution if reporting or notification workloads become independently scalable.

#### Method D: Event-driven architecture with CQRS

CQRS and an event log would be attractive for QR-4 and FR-4 because kiosk and search read models could be updated from reservation events. It would provide a clear audit history and potentially high read scalability.

However, event propagation introduces eventual consistency. A reservation might be accepted before the search model or kiosk projection is updated. This creates additional work to guarantee the ten-second kiosk requirement, handle replay and repair projections, and operate the event infrastructure. It is disproportionate for the initial scale and would complicate QR-6.

The selected design uses a smaller version of the useful idea: domain events are written to an outbox transactionally, and a worker processes them for kiosk invalidation and notifications. The reservation decision itself remains synchronous and strongly consistent.

---

## 3. Structure

### 3.1 Container/component diagram

```text
                         +----------------------+
                         | Students / Staff     |
                         | Web or mobile client |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         | HTTP/API adapter     |
                         | REST, validation,    |
                         | rate limiting        |
                         +----------+-----------+
                                    |
                                    v
+-------------------+     +----------------------+
| SAML IdP          |<--->| Authentication port  |
+-------------------+     +----------+-----------+
                                       |
                                       v
                         +----------------------+
                         | Application use cases|
                         | Search, reservation, |
                         | blocks, reports      |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         | Domain core          |
                         | Reservation rules,   |
                         | policies, events     |
                         +----+------------+----+
                              |            |
                    output ports            |
                              |            v
              +---------------+--+  +----------------------+
              | PostgreSQL       |  | Outbox/background    |
              | repositories,    |  | worker               |
              | search indexes,  |  | reminders, cache    |
              | audit, outbox    |  | invalidation         |
              +------------------+  +----+------------+----+
                                           |            |
                                           v            v
                                +----------------+  +----------------+
                                | Email/push     |  | Kiosk schedule |
                                | adapter        |  | API/cache      |
                                +----------------+  +----------------+

+----------------------+       +----------------------+
| iCal facilities feed |<----->| Calendar adapter    |
+----------------------+       +----------------------+

+----------------------+       +----------------------+
| Legacy PostgreSQL    |<----->| Inventory adapter   |
| room inventory      |       | scheduled import    |
+----------------------+       +----------------------+
```

The external systems are accessed only through adapters. The domain core does not import database, HTTP, SAML or provider-specific classes.

### 3.2 FR-1 walkthrough: search availability

1. The client sends `GET /rooms?campus=&capacity=&equipment=&from=&to=`.
2. The HTTP adapter validates the parameters and obtains the authenticated actor from the SAML session.
3. The search use case checks that the campus is enabled and loads configured campus rules.
4. The room repository queries the local indexed room and availability data. Inventory and iCal data have been imported asynchronously, so search does not depend on external-system response time.
5. The application applies any final availability constraints and returns a paginated result.
6. Metrics record request duration, result count, campus, status and cache outcome. No user PII is placed in logs.

A reservation is not trusted merely because it appeared in search results. When a user creates a reservation, the reservation use case repeats conflict checks inside a database transaction and uses an exclusion constraint or equivalent locking strategy to prevent concurrent double booking.

### 3.3 FR-4 walkthrough: kiosk refresh

1. A reservation, modification, cancellation or block-booking change is committed in the same transaction as an outbox record.
2. The background worker reads the outbox record and invalidates or refreshes the affected room’s schedule cache.
3. Kiosks poll `GET /kiosk/{roomId}/schedule` every five seconds, or use server-sent events where supported.
4. The API returns the current schedule and a version or ETag. A changed version causes the kiosk to update its local cache.
5. The target is that the changed schedule is visible within ten seconds. The kiosk records the last successful refresh time.
6. If the kiosk is offline, it displays the last-known schedule, its age and an offline warning. It does not allow reservations.

The five-second polling interval provides a simple fallback even if background cache invalidation is delayed. The kiosk is therefore resilient to both temporary network failure and worker delay.

---

## 4. Quality plan

### 4.1 Testing strategy

#### Unit tests

Unit tests will focus on the framework-independent domain and application policies. They will use in-memory repositories, fake clocks and fake event publishers.

Important cases include:

- overlapping reservations;
- adjacent reservations that do not overlap;
- the three-hour-per-day limit;
- modifications that do not incorrectly count the original reservation twice;
- cancellation;
- recurring block bookings;
- 48-hour notice and affected student reservations;
- opening-hours and timezone rules;
- equipment and capacity constraints;
- campus configuration;
- idempotent processing of outbox messages.

These tests directly satisfy QR-5. They should run on every commit and form the majority of the test suite.

#### Adapter and integration tests

Integration tests will run against containerised PostgreSQL and verify:

- repository queries and indexes;
- transaction boundaries;
- conflict prevention under concurrent reservation requests;
- database constraints and migrations;
- outbox records being committed atomically with reservations;
- report aggregation;
- cache and ETag behaviour.

External integrations will be tested using controlled stubs or sandbox endpoints. iCal parsing tests will include malformed feeds, timezone changes and duplicate events.

#### Contract tests

Contracts will define the REST request and response schemas, error codes and authentication expectations. They will verify that clients receive stable representations, including `409 Conflict` for booking conflicts.

Provider contracts will cover:

- SAML assertion fields and role mapping;
- iCal feed format;
- notification-provider request and retry behaviour;
- kiosk schedule response and cache headers.

Contract tests prevent changes to adapters or external assumptions from silently breaking the application.

#### End-to-end tests

A small number of end-to-end tests will run against a production-like deployment:

1. authenticate as a student;
2. search for an available room;
3. create a reservation;
4. verify it appears in search and on the kiosk endpoint;
5. modify and cancel it;
6. authenticate as staff and create a block booking;
7. verify audit output and notification scheduling.

The kiosk test will measure time from reservation commit to updated schedule response and target less than ten seconds.

#### Performance, resilience and security tests

Before release, load tests will simulate at least 2,000 concurrent users with semester-start search traffic. The acceptance threshold is search p95 below 400 ms, with error rate and database saturation also reviewed.

Resilience tests will stop the iCal service, inventory import, notification provider and one application instance. Expected behaviour is continued reservation/search operation where cached or local data is sufficient, visible integration health degradation, and retry through the outbox.

Security tests will include SAML validation, role escalation attempts, authorisation checks, injection testing, dependency scanning and verification that PII is absent from logs.

### 4.2 Delivery

The repository will use short-lived feature branches and pull requests into `main`. Each pull request requires review by the other engineer where practical and must pass:

- compilation and static analysis;
- unit tests;
- integration tests;
- contract tests;
- migration validation;
- dependency and security scans;
- formatting and test-coverage thresholds;
- a basic container build.

A merge to `main` creates an immutable versioned image. Deployment proceeds automatically to a staging environment, followed by smoke and end-to-end tests. Production deployment uses a rolling or blue-green strategy with health checks.

Database migrations must be:

1. additive and backward-compatible first;
2. deployed before code that depends on them;
3. destructive only in a later cleanup release.

The deployment process records the image version, migration version and configuration version. The previous image remains available. If health checks fail, error rates rise, or a smoke test fails, traffic is returned to the previous image. Rollback is rehearsed and must complete within ten minutes. Feature flags allow risky capabilities, such as push kiosk updates, to be disabled without redeployment.

### 4.3 Observability

#### Logs

Structured logs will include:

- timestamp and correlation ID;
- operation name and result;
- HTTP status;
- campus and room identifiers where needed;
- latency;
- dependency name and failure type;
- deployment version.

Staff audit logs separately record actor, role, action, target, timestamp, outcome and reason. Logs will not include names, email addresses, SAML assertions, session tokens, reservation descriptions or other unnecessary PII. Identifiers will be minimised or pseudonymised.

#### Metrics

To verify QR-1:

- application availability during configured opening hours;
- successful and failed requests by endpoint;
- 5xx rate;
- database availability and connection pool exhaustion;
- health of iCal and inventory synchronisation;
- outbox backlog and oldest unprocessed event;
- notification delivery and retry rates;
- kiosk refresh success rate;
- kiosk last-successful-refresh age;
- percentage of kiosks displaying stale data.

To verify QR-2:

- search request count and p50/p95/p99 latency;
- reservation write latency;
- cache hit rate;
- database query latency;
- CPU, memory, connection pool and lock-wait utilisation;
- request rate and error rate during peak periods.

#### Alerts

Alerts will include:

- monthly availability projection below 99.5%;
- search p95 above 400 ms for five consecutive minutes under meaningful traffic;
- search error rate above 1% for five minutes;
- any kiosk with no successful refresh for two polling intervals;
- more than 10% of kiosks stale for five minutes;
- outbox oldest-message age above 30 seconds;
- inventory or calendar import failure for two consecutive runs;
- database CPU above 80% or connection pool above 90%;
- failed deployment smoke tests.

Dashboards will show these measures by campus and deployment version so that local integration failures can be distinguished from application-wide failures.

---

## 5. Risks and mitigations

| Risk | Likelihood | Impact | Measurable trigger | Mitigation |
|---|---|---|---|---|
| Concurrent requests create double bookings | Medium | High | Any automated concurrency test creates overlapping confirmed reservations | Enforce transactional conflict detection and database exclusion/locking; run concurrency tests before release |
| Search exceeds 400 ms at semester start | Medium | High | Load test or production search p95 exceeds 400 ms for five minutes | Precompute local availability, add indexes, cache bounded searches, tune queries and scale application instances |
| Kiosk updates exceed ten seconds | Medium | High | More than 1% of reservation changes take over ten seconds to appear in kiosk responses | Use transactional outbox, five-second polling, cache invalidation, backlog alerting and local last-known cache |
| SAML integration or role mapping is incorrect | Medium | High | Staging authentication failure rate exceeds 1%, or an authorisation test grants an unauthorised staff action | Obtain IdP test accounts early, use contract tests, deny by default and review role mappings |
| iCal or inventory data becomes stale or malformed | High | Medium | Import age exceeds two scheduled intervals, or parsing failures exceed 1% of feed records | Validate and quarantine bad records, retain last-known-good data, alert operators and expose source freshness |
| Notification provider is unavailable | Medium | Medium | Provider failure rate exceeds 5% or outbox backlog is older than five minutes | Persist reminder jobs, retry with exponential backoff, use idempotency keys and provide operational failure reporting |
| Database migration prevents rollback | Low | High | Staging rollback fails or migration is not backward-compatible | Require expand/contract migrations, test rollback on a database copy and retain backups |
| Two-person team cannot operate the system reliably | Medium | High | Any production incident lacks a documented runbook or takes over 15 minutes to diagnose | Keep one deployable, automate deployment, maintain dashboards/runbooks and rehearse rollback monthly |
| Privacy data appears in logs | Low | High | Automated log scan detects email, SAML assertion or token patterns | Central redaction middleware, structured logging allow-list, security review and automated log tests |
| Campus onboarding requires code changes | Medium | Medium | A staging campus cannot be added through configuration and data import alone | Define a versioned campus configuration schema and acceptance test for onboarding a new campus |

---

## 6. Open questions for the product owner

1. What are the authoritative rules for campus opening hours, public holidays and daylight-saving-time changes?
2. When a staff block booking overrides student reservations, should CLRS automatically cancel them, offer alternative rooms or only notify affected users?
3. Does “48 hours’ notice” mean exactly 48 hours before the booking starts, or two calendar days?
4. Are users allowed to hold multiple reservations whose total duration is three hours, and how are overlapping or modified reservations counted?
5. What is the required retention period for staff audit records and utilisation reports?
6. Which SAML attributes identify students, staff and library administrators?
7. Are kiosk devices authenticated using device certificates, provisioned tokens or another university mechanism?
8. Is five-second polling acceptable for the kiosk network, or is server-sent events required?
9. How stale may inventory and facilities-calendar data be before rooms must be removed from search?
10. What are the expected peak numbers of kiosks, rooms, searches and reservation writes?
11. Which email and push providers are approved, and what delivery guarantee is required for reminders?
12. Should utilisation reports include cancelled reservations, block bookings and no-show information?

---

## Appendix A — Generative AI declaration

Generative AI was used to help brainstorm and edit the structure, architecture trade-offs, testing strategy, observability measures and risk table. The student remains responsible for checking the technical accuracy, adapting the document to their own design decisions and ensuring that the submitted work complies with the course academic-integrity requirements.