# CS 3410 Software Engineering — Assignment 2  
## Architecture and Quality Plan for the Campus Library Reservation System

**Student:** [Student ID]  
**Semester:** Fall 2026  

---

## 1. Context and scope

The Campus Library Reservation System (CLRS) will replace the university’s existing study-room reservation tool. It will support students and staff across three campus libraries. Students will search for available rooms and equipment, create or modify reservations, and cancel reservations. Library staff will manage rooms, opening hours, recurring block bookings, and utilisation reports. Kiosks outside rooms will display the current and next reservation.

CLRS must integrate with three existing systems: the university identity provider using SAML, facilities calendars through iCal feeds, and a read-only PostgreSQL room-inventory database. The system must enforce reservation rules, including the three-hour daily limit and staff block bookings that override student bookings with 48 hours’ notice.

This design covers the first release’s architecture, quality strategy, delivery process, operational monitoring, risks, and unresolved product decisions. It does not specify implementation-level details such as programming language or cloud vendor.

The primary quality concerns are availability during library opening hours, fast availability searches under semester-start load, secure authentication and auditing, configuration-only onboarding of new libraries, database-independent testing of reservation rules, and safe operation by a two-person team.

---

## 2. Architectural decision

### 2.1 Decision

CLRS will use **Method C: Hexagonal Architecture**, implemented initially as a single deployable application with a framework-independent domain core.

Hexagonal architecture separates the business rules from infrastructure and user-interface concerns. The reservation domain will communicate with external systems through explicit inbound and outbound ports. Adapters will implement those ports for HTTP, SAML, PostgreSQL, iCal, email/push delivery, and kiosk communication.

The application may be deployed as one container or service in the first release. This keeps operational complexity low while preserving boundaries that could support later extraction of components if justified by measured demand.

### 2.2 Rationale against the quality requirements

**QR-1 — Availability.**  
A single deployable application is easier for a two-person team to operate than several independently deployed services. It has fewer network dependencies and fewer failure points during normal requests. The application will use health checks, redundant instances where practical, database backups, and graceful degradation for kiosks.

Kiosks will cache their last-known schedule locally. They will display that schedule, together with its timestamp and an “offline” indicator, if the CLRS connection is unavailable. Kiosk updates will use a notification adapter, with polling as a fallback. This means a temporary server or network failure does not result in a blank display.

The architecture does not eliminate the risk of a shared database or application failure. That risk is addressed through database backups, deployment health checks, and tested rollback procedures.

**QR-2 — Performance.**  
Availability search will use a read-optimised availability representation rather than repeatedly querying the legacy inventory database or calculating all conflicts from raw data. The inventory and iCal adapters will synchronise room metadata and external calendar blocks into CLRS-owned storage. Search can then use indexed campus, capacity, equipment, and time-window fields.

The hexagonal boundary makes it possible to introduce caching or a specialised search adapter without changing reservation rules. A load test will verify the target of p95 below 400 ms with 2,000 concurrent users. The chosen design gives up some of the independent horizontal scaling available from microservices or CQRS, but it avoids their additional operational overhead for the first release.

**QR-3 — Security.**  
Authentication is isolated behind an inbound identity port and SAML adapter. Controllers do not implement authentication themselves; they receive an authenticated user context from the adapter. Staff-only use cases enforce roles in the application layer, not only in the user interface.

Audit recording is an outbound port used by staff operations such as creating block bookings, changing opening hours, and managing rooms. Audit records contain the actor identifier, action, target type and identifier, result, and timestamp. Ordinary application logs use correlation IDs and technical identifiers only; they do not contain names, email addresses, SAML assertions, or reservation descriptions containing personal information.

**QR-4 — Modifiability.**  
Library-specific information will be configuration: campus identifier, opening hours, room rules, equipment taxonomy, time zone, kiosk mappings, and relevant iCal feeds. The domain uses a generic `Campus` and `Room` model rather than hard-coded campus names. A new campus can therefore be onboarded by adding validated configuration, importing its rooms, and registering its integrations.

The trade-off is that configuration must be carefully validated. A flexible configuration system can produce runtime errors if invalid values are accepted. Startup validation and an administrative configuration check will mitigate this risk.

**QR-5 — Testability.**  
The reservation domain will be framework-independent. Its use cases will depend on ports such as `ReservationRepository`, `RoomAvailability`, `Clock`, `NotificationScheduler`, and `AuditLog`. Unit tests can provide in-memory fakes for these ports, with no database, SAML provider, network, or wall clock required.

This directly supports tests of the three-hour daily limit, overlapping reservations, cancellation, modification, recurring block bookings, 48-hour notice, and staff permissions. The architecture also makes integration tests explicit because adapters are isolated at the edges.

**QR-6 — Operability.**  
A single deployable artifact can be built, scanned, deployed, observed, and rolled back by two people. Database migrations will be backward-compatible and run separately from application activation where possible. Releases will use a versioned container image and a previous-image rollback procedure. The deployment pipeline must demonstrate rollback within ten minutes in a rehearsal.

### 2.3 Rejected alternatives and trade-offs

#### Method A — Layered monolith

A layered monolith would be simple to deploy and could meet QR-1 and QR-6. However, traditional layered designs often allow the domain layer to depend indirectly on frameworks, databases, or web classes. That would make QR-5 weaker because business rules become difficult to test without infrastructure.

A layered monolith could also meet the other requirements if carefully implemented, but hexagonal architecture makes the dependency direction and external boundaries explicit. We give up some initial simplicity through additional interfaces and adapter code.

#### Method B — Microservices

Microservices would allow reservation, notification, reporting, and inventory workloads to scale independently. They could isolate failures and support separate release schedules. However, for a two-person team they introduce service discovery, distributed tracing, multiple deployment pipelines, network failures, cross-service authentication, and more complicated data consistency.

Reservation creation, block-booking overrides, availability, and kiosk updates are closely related. Splitting them too early could create race conditions and distributed transactions. Microservices would therefore make QR-6 harder and could harm QR-1 through additional failure points. They would also make end-to-end and contract testing more extensive. CLRS gives up independent service scaling in exchange for simpler operation and consistency.

#### Method D — Event-driven architecture with CQRS

CQRS would be attractive for FR-1 and FR-4. Search and kiosk projections could be optimised independently, and reservation changes could be distributed through an event log. It could also support reliable notification processing and replay.

However, event-driven CQRS introduces eventual consistency. A user could create a reservation successfully while the search projection still shows the room as available. That is especially risky for reservation conflicts. It also requires event schema governance, replay procedures, idempotent consumers, and operational expertise. These costs are disproportionate for the first release and create rollback and troubleshooting challenges under QR-6.

The selected architecture may still publish domain events through an outbound port for kiosk and notification updates, but it will not make a full event log and CQRS projection the primary architectural style. A later search projection can be introduced if performance measurements require it.

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
                         | HTTP inbound adapter |
                         | REST controllers     |
                         +----------+-----------+
                                    |
                                    v
+------------------------------------------------------------------+
|                       CLRS application                            |
|                                                                  |
|  +------------------+     +-------------------------------+      |
|  | Application      | --> | Framework-independent domain  |      |
|  | use cases        |     | Reservation, Room, User,       |      |
|  | search/reserve/  |     | Booking and policy rules       |      |
|  | report/kiosk     |     +-------------------------------+      |
|  +------------------+                    |                       |
|                                          v                       |
|                              +-------------------------+         |
|                              | Outbound ports          |         |
|                              | repositories, clock,   |         |
|                              | audit, notifications,   |         |
|                              | kiosk updates           |         |
|                              +------------+------------+         |
+-------------------------------------------|----------------------+
                                            |
              +-----------------------------+----------------------+
              |             |                |          |          |
              v             v                v          v          v
       CLRS database   Inventory adapter  iCal       SAML     Notification
       and indexes     -> legacy PG       adapter    adapter   email/push
                                            |
                                            v
                                      Facilities feeds

       Kiosk clients <------ kiosk update adapter / polling endpoint
```

### 3.2 Walkthrough of FR-1: availability search

1. A client sends `GET /rooms?campus=&capacity=&equipment=&from=&to=`.
2. The HTTP adapter validates syntax, authenticates the user through the SAML session, and creates a `SearchAvailability` command.
3. The application service invokes the availability query port.
4. The storage adapter queries CLRS-owned room and availability tables using indexes on campus, capacity, equipment, and time ranges. It also considers student reservations, staff block bookings, opening hours, facilities-calendar blocks, and room status.
5. The application layer applies any remaining policy rules and returns matching rooms.
6. The adapter serialises the result without exposing internal database structures.

The legacy inventory database is read through an adapter and synchronised into CLRS-owned read data. Search therefore does not depend on the legacy database being available for every request. Synchronisation freshness and failures are monitored.

### 3.3 Walkthrough of FR-4: kiosk refresh

1. A reservation is created, modified, cancelled, or overridden by a staff block booking.
2. The reservation use case commits the change transactionally.
3. It records a room-specific update notification through the kiosk update port. The notification contains a room identifier and version, not personal information.
4. The kiosk adapter delivers the update through a lightweight push channel, such as server-sent events or WebSocket. The kiosk then requests `GET /kiosk/{roomId}/schedule`.
5. If push delivery fails, the kiosk polls periodically, for example every five seconds.
6. The kiosk stores the latest successful schedule locally. If it cannot contact CLRS, it displays that schedule with its last-updated time and offline status.
7. The service measures the time from reservation commit to kiosk acknowledgement. The operational target is below ten seconds.

The update mechanism must be idempotent: a kiosk receiving the same or an older version must not replace a newer schedule.

---

## 4. Quality plan

### 4.1 Testing strategy

**Domain unit tests.**  
These are the largest test group and run without a database or network. They use fake repositories, a controllable clock, and fake notification/audit ports. They cover:

- maximum three hours of reservations per user per day;
- overlapping reservations and conflict detection;
- creation, modification, and cancellation;
- recurring block bookings;
- 48-hour notice rules;
- staff permissions;
- opening hours and room eligibility;
- campus configuration;
- time-zone and daylight-saving behaviour.

Property-based tests will generate time windows to detect boundary errors.

**Application-service tests.**  
These verify orchestration and transaction behaviour using in-memory or mocked ports. Examples include ensuring a successful reservation schedules a reminder, a failed conflict does not schedule one, and staff actions create an audit record.

**Adapter integration tests.**  
Containerised PostgreSQL tests will verify indexes, transactions, uniqueness constraints, overlap protection, migrations, and report queries. SAML adapter tests will use a test identity provider or signed test assertions. iCal tests will cover malformed feeds, time zones, duplicates, and feed outages. Notification tests will use a provider sandbox.

**Contract tests.**  
The HTTP API will have an explicit OpenAPI contract. Consumer tests will verify response status codes, validation errors, authentication failures, conflict responses, and kiosk schedule formats. Adapter contracts will verify assumptions about SAML claims, iCal fields, and email/push provider responses.

**End-to-end tests.**  
A small suite will exercise the deployed application through the public interface: sign in, search, reserve, modify, cancel, create a staff block booking, and view a kiosk schedule. These tests will include the reminder workflow and a simulated external calendar failure. The suite will not attempt to duplicate every domain rule already covered by unit tests.

**Performance and resilience tests.**  
A production-like environment will run 2,000 concurrent availability searches and a mixed workload of searches and reservations. The release gate is p95 search latency below 400 ms, with error rate and database saturation also checked. Failure tests will stop the iCal service, notification provider, and kiosk connection to confirm graceful degradation.

### 4.2 Delivery

The repository will use short-lived feature branches and pull requests into `main`. Each pull request requires code review, passing automated tests, static analysis, dependency scanning, database migration checks, and no unauthorised changes to API contracts.

The CI pipeline will include:

1. formatting and lint checks;
2. domain and application unit tests;
3. adapter integration tests;
4. contract tests;
5. security and dependency scans;
6. container build and vulnerability scan;
7. deployment to a staging environment;
8. smoke and selected end-to-end tests;
9. performance tests for scheduled release candidates.

Releases will use versioned immutable container images. A canary instance or rolling deployment will first receive a small proportion of traffic. Health checks will include database connectivity, SAML configuration, and readiness of required adapters.

Database changes will follow an expand-and-contract approach: add compatible schema first, deploy code using it, and remove obsolete structures only in a later release. This keeps the previous application version usable during rollback.

Rollback will redeploy the previous image and disable the new release through the deployment platform. The team will maintain a written runbook and rehearse it before launch. The target is a completed rollback within ten minutes, satisfying QR-6.

### 4.3 Observability

Logs will be structured and correlated using a request ID. They will record request type, status, duration, campus, room identifier where operationally necessary, adapter failures, deployment version, and error category. They will not record names, email addresses, SAML assertions, reservation titles, or other PII. Staff audit records are stored separately from diagnostic logs and have controlled access.

The following metrics will be collected:

- successful and failed requests by endpoint;
- search latency p50, p95, and p99;
- search timeout and error rates;
- reservation conflict rate;
- database query latency and connection pool saturation;
- application CPU, memory, and restart count;
- SAML authentication failures and latency;
- iCal feed age and synchronisation errors;
- notification queue depth and delivery delay;
- kiosk update propagation time;
- number of kiosks connected, polling, stale, or offline;
- availability by opening-hours minute.

Alerts include:

- monthly availability projection below 99.5%;
- elevated five-minute error rate or repeated health-check failures;
- search p95 above 400 ms for two consecutive five-minute windows under normal load;
- kiosk update propagation above ten seconds for more than 1% of changes;
- a kiosk schedule older than an agreed threshold;
- iCal synchronisation exceeding its freshness limit;
- notification delivery failures or queue age above the reminder tolerance;
- database storage, CPU, or connection saturation.

A monthly availability report will exclude scheduled maintenance and clearly document the measurement window. Synthetic searches from each campus will test QR-1 even when there is little real traffic.

---

## 5. Risks and mitigations

| Risk | Likelihood | Impact | Measurable trigger | Mitigation |
|---|---|---|---|---|
| Legacy inventory database is slow or unavailable | Medium | High: searches become slow or inaccurate | Inventory query p95 above 300 ms, or synchronisation older than 15 minutes | Synchronise required room data into CLRS-owned storage; cache last successful data; alert on feed age; provide an operational reconciliation job |
| SAML integration or claims mapping is incorrect | Medium | High: users cannot sign in or receive wrong permissions | Authentication failure rate above 2% for 15 minutes, or staff authorisation test fails | Obtain test IdP early; use signed test assertions; document claim mappings; test student/staff roles; retain a controlled emergency staff account |
| Concurrent reservations cause double booking | Medium | Critical: loss of trust in system | Any production invariant violation or duplicate overlapping reservation detected | Enforce database transaction/constraint protection; use idempotency keys; stress-test concurrent booking; run reconciliation queries |
| Kiosk updates exceed ten seconds | Medium | Medium: displays show stale schedules | More than 1% of updates exceed ten seconds in a 15-minute period | Use versioned room updates, push plus polling fallback, local last-known cache, and synthetic kiosk monitoring |
| Semester-start traffic exceeds capacity | Medium | High: QR-2 failure or outage | Load test p95 above 400 ms or database CPU above 75% at target load | Run capacity tests before launch; index search fields; cache stable room metadata; scale application instances; rate-limit abusive requests |
| iCal feeds contain invalid or conflicting data | Medium | Medium: rooms appear incorrectly unavailable | More than 1% of feed entries rejected, or feed freshness exceeds 15 minutes | Validate and quarantine bad entries; retain last-known valid feed; report errors to facilities staff; define source precedence |
| Reminder provider fails or is delayed | Medium | Medium: users miss reservations | More than 2% of reminders fail, or p95 delivery delay exceeds five minutes | Use a durable notification queue, retries with backoff, provider monitoring, and an administrative resend facility |
| Configuration for a new campus is invalid | Low/Medium | Medium: onboarding delay or incorrect availability | Configuration validation fails or staging smoke test finds missing rooms/opening hours | Schema validation at startup and CI; configuration review; staging onboarding rehearsal; no hard-coded campus logic |
| Deployment rollback is slower than ten minutes | Low | High: prolonged outage | Rehearsal rollback exceeds ten minutes | Immutable images, backward-compatible migrations, automated rollback command, runbook, and quarterly rehearsal |
| Scope or policy decisions remain unresolved | Medium | Medium/High: rework and delayed delivery | Any acceptance criterion lacks an agreed owner by the end of design | Maintain a decision log; obtain product-owner decisions on precedence, time zones, cancellation and notice rules before implementation |

---

## 6. Open questions for the product owner

1. When an iCal facilities block conflicts with a student reservation, which source has priority?
2. What exactly counts toward the three-hour daily limit: reservation duration, actual attendance, or only non-cancelled bookings?
3. Does the three-hour limit use the user’s local campus time or a single university time zone?
4. What happens to existing student reservations when a staff block booking is created with 48 hours’ notice?
5. Are users notified by email, push notification, or both? What is the approved message content?
6. How fresh must synchronised inventory and iCal data be before the system should mark it as unreliable?
7. What is the maximum acceptable age of a kiosk’s last-known schedule?
8. Should staff be able to override the three-hour user limit or other reservation rules?
9. What are the expected library opening hours and planned maintenance windows for availability reporting?
10. Which staff actions require audit records, and how long must those records be retained?
11. Is anonymous kiosk access acceptable, or must each kiosk authenticate using a device credential?
12. What accessibility, browser, mobile, and kiosk hardware requirements must be included in the first release?

---

## Appendix A — Generative AI declaration

Generative AI was used to assist with brainstorming, organisation, and editing of this design document. The submitted document must be reviewed and amended by the student to reflect their own architectural reasoning, course terminology, and design decisions. The student remains responsible for verifying all technical claims and for the final content.