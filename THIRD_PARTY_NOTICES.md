# Third-party data

`src/geo/mainland.json` contains the unmodified CHN geometry extracted from
Natural Earth's `ne_10m_admin_0_map_units.geojson` (1:10m):

- Source: <https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_map_units.geojson>
- Revision: `ca96624a56bd078437bca8184e78163e5039ad19`
- Retrieved: 2026-09-11
- License: public domain; <https://www.naturalearthdata.com/about/terms-of-use/>

Used only as an approximate coordinate-transform applicability mask. It is not
a surveyed boundary, a map product, or an assertion about territorial status.
Reclaimed land, very small islands and border/coastline points need separate validation.

TREK source was read to document its HTTP contract. No TREK implementation is
copied into this service. Dependency licenses are distributed with their packages.
