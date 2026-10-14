# Asian Movies v0.17.0

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

Catalogs use IMDb IDs. RoPhimHD now supplies a stream resource as well as live
catalog updates. Its public web client on 2026-10-04 uses phimapi.com; this
adapter calls the same public country, search and movie-detail endpoints.
It does not use credentials, extract protected players, or proxy media.
Motchilla and THVLi modules and routes are not loaded.

The runtime refreshes RoPhimHD, iQIYI and ZonaParfum every six hours, retaining
existing entries if upstream calls fail. RoPhimHD scans three Vietnamese pages
and one page for each of eleven other Asian country feeds, 24 titles per page.
IMDb metadata is verified with Cinemeta before entering the catalog. Entries
without IMDb metadata may be omitted. New ID matching is conservative.
Vietnamese search supports đ/d. Existing catalog positions remain stable.

RoPhimHD streams require an exact upstream IMDb ID and matching content type.
Series additionally require an explicit season and exact numeric episode;
ambiguous seasons, specials and combined episodes are omitted. Movies require
a Full entry. The adapter returns only HTTPS HLS URLs, deduplicated, with a
five-minute bounded cache and request timeouts. Failures return an empty stream
list so other installed addons remain usable. Browser embed URLs are not
misrepresented as video URLs. HLS availability still depends on the source/CDN
and the Stremio player's network and format support. On 2026-10-04 the tested
kvp726.com CDN returned a page explicitly requiring a Vietnamese network.
Those streams carry a Vietnam country hint and visible note. This adapter
does not bypass that restriction; playback was not verified from abroad.

Source slug/season mappings persist alongside catalogs; playback URLs are
fetched fresh after restart. `/health` reports source sync status, indexed
titles and the latest uncached stream lookup result. The existing manifest
URL and addon ID are unchanged. Reinstall/update the addon in Stremio to pick
up the newly declared stream resource.

For persistence across restarts and deploys, set `CATALOG_REDIS_HOST` to the
existing private Render Key Value host; optional `CATALOG_REDIS_PORT` defaults
to 6379. This integration uses private-network unauthenticated Redis only.
The key `asian:catalog:v0150` is separate from tracker keys. Without Redis,
the runtime uses a local cache and the committed snapshot; local changes may
be lost on redeploy. Storage state is reported by `/health`.

## Checks

Run `node build-asian.cjs` followed by `node verify-asian.cjs` and `node verify-rophim.cjs`, `node verify-native-fallback.cjs`.
The checks exercise the HTTP manifest, health, catalog paging, unique IDs,
region filtering, retaining entries on empty updates, and Vietnamese search.

Other apps in this repository retain their existing entry points and settings.

Version 0.15.1 keeps existing title positions during sync and appends newly
discovered titles. Catalog responses use no-store to prevent mixed cached pages.
Regression checks refresh titles in reverse order between page requests.


## NguonC (v0.17.0)

Adds `phim.nguonc.com` recent-update catalogs and direct HLS lookup to the existing
four Asian/Vietnamese catalogs and IMDb stream endpoint. Keeps the manifest URL,
addon ID, old providers and catalog positions. Sources run independently during
stream lookup; an unavailable NguonC does not discard RoPhimHD results.

Every six hours, scans at most two recent pages / 48 details. Requires source
Asian-country metadata, a recognized movie/series category, and an exact
normalized title plus release-year match against independently fetched Cinemeta
metadata before saving an IMDb mapping. Uncertain matches are omitted. Series
playback additionally requires an explicit season and exact episode number.
Only HTTPS .m3u8 URLs supplied by the API are returned; embed pages are omitted.
Titles with embed-only playback can still use other installed stream addons.

Mappings persist under `nguoncLinks` with the existing catalog cache/Redis key.
The API cache is bounded to 200 entries / five minutes. A 403 starts a five-minute
cooldown. Existing entries survive empty responses/outages. `/health` now includes
`sourceStatus.nguonc` and the latest NguonC request/stream result.

Checks: `node build-asian.cjs`, `node verify-asian.cjs`,
`node verify-rophim.cjs`, `node verify-nguonc.cjs`.
These passed locally using fixture responses for NguonC. The prior Railway test
of NguonC returned HTTP 403; changing addon does not remove that restriction.
Render runtime access and real playback are NOT yet verified for this version.


## v0.18.0 — NguonC rebuild (2026-10-13)

Rebuilt from the verified v0.17.0 GitHub source; this is not a recovery of the missing v0.17.7 code.

- Four native NguonC catalogs: Asian movies/series and dedicated Vietnamese movies/series. Country/type must be verified in source detail; missing country or Western-only content is excluded. IMDb is no longer required for these catalogs.
- Native `nguonc:` metadata and exact episode IDs; a source slug has one local season. Cross-source fallback requires the same full title, compatible original title, year, country and type; series require an explicit target season matching the source season (or first season for an unnumbered native slug).
- Sync recent updates and Vietnam country pages every six hours while service runs. Progressively scan four older Vietnam pages each successful sync. Preserve native catalog records/cursor in the existing Redis/local snapshot; failed requests do not erase catalogs. Search covers indexed records.
- Direct HTTPS HLS/MP4 fields, alternate-field fallback, deduplication, no trailer or embed-as-video. Raw StreamC external links are not offered. If there is no direct link, try existing RoPhim only after exact title/year/original-title/country/type verification, even without IMDb; reject ambiguous matches, uncertain target season and absent episode.
- StreamC access-blocked pages cannot be converted into playable HLS by this change. Some titles may still have no streams. Returning a stream URL is not proof of playback on Android TV.
- Validation: `node build-asian.cjs`, `node verify-asian.cjs`, `node verify-nguonc.cjs`, `node verify-nguonc-native.cjs`, `node verify-rophim.cjs`, `node verify-native-fallback.cjs`.

## v0.18.1 — Correct website fallback

Keep native HLS/MP4 first and verified RoPhim HLS second. When neither exists, return `NguonC · Trang phim` pointing to the canonical `https://phim.nguonc.com/phim/{slug}` page, never directly to StreamC embed. Series labels tell the viewer to select the requested episode on that page; no unverified deep-link parameters are used. Only return the option for a known matching episode. Previously verified cached records can retain the website option during API outages, but expired cached direct URLs are not reused. IMDb results deduplicate by URL or externalUrl. This is browser playback, not a StreamC-to-HLS extractor.
