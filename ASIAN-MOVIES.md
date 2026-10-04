# Asian Movies v0.15.1

Recovered the catalog runtime previously embedded in Render build commands.

## Existing Render service

- Service: `asian-movies-v013-zona` (`srv-dauisrh7lnhs73bi264g`)
- Build command: `node build-asian.cjs`
- Start command: `node asian-v013.js`
- Health check: `/health`
- Keep the existing manifest URL and addon ID.

The build requires no external catalog fetches or npm dependencies. The committed
snapshot includes the previously served RoPhim additions and 160 Asian movies,
133 Asian series, 71 Vietnamese movies and 6 Vietnamese series. Vietnamese
titles overlap the Asian lists; these are not unique-title totals.

Catalogs use IMDb IDs and rely on installed stream addons for playback. This
service does not claim to extract playable RoPhim streams. RoPhim returned
HTTP 403 during verification on 2026-10-04 (Vietnam time); live RoPhim sync is
not implemented. Motchilla and THVLi modules and routes are not loaded.

The runtime refreshes iQIYI and ZonaParfum every six hours, retaining existing
entries if upstream calls fail. Sync work has a time budget. New ID matching is
conservative to reduce wrong-title matches. Vietnamese search supports đ/d.

For persistence across restarts and deploys, set `CATALOG_REDIS_HOST` to the
existing private Render Key Value host; optional `CATALOG_REDIS_PORT` defaults
to 6379. This integration uses private-network unauthenticated Redis only.
The key `asian:catalog:v0150` is separate from tracker keys. Without Redis,
the runtime uses a local cache and the committed snapshot; local changes may
be lost on redeploy. Storage state is reported by `/health`.

## Checks

Run `node build-asian.cjs` followed by `node verify-asian.cjs`.
The checks exercise the HTTP manifest, health, catalog paging, unique IDs,
region filtering, retaining entries on empty updates, and Vietnamese search.

Other apps in this repository retain their existing entry points and settings.

Version 0.15.1 keeps existing title positions during sync and appends newly
discovered titles. Catalog responses use no-store to prevent mixed cached pages.
Regression checks refresh titles in reverse order between page requests.
