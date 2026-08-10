## Selected API

- Endpoint: `https://www.noon.com/_vs/mp/mp-trust-api/product-reviews/sku/list`
- Method: `POST`
- Auth: No bearer token. The endpoint requires a valid Noon browser session, storefront headers, and a matching referer.
- Pagination: `page` and `perPage`
- Request payload keys:
  - `sku`
  - `lang`
  - `ratings`
  - `provideBreakdown`
  - `page`
  - `perPage`
  - `sortFilter`
  - `imagesFilter`
  - `grouped`
  - `verifiedPurchase`
- Review fields confirmed in a successful local run:
  - `sku`
  - `displayName`
  - `title`
  - `rating`
  - `comment`
  - `titleTranslation`
  - `commentTranslation`
  - `updatedAt`
  - `helpfulCount`
  - `isVerifiedPurchase`
  - `imageUrls`
  - `imageUrlsV2`
  - `productGroupVariant`
  - `showTranslateBtn`
  - `language`
  - `uid`

The actor maps the stable review fields and preserves additional non-empty source fields. The confirmed output contains 17 fields, compared with the 14 fields declared in the dataset schema.

## Endpoint Scoring

- Returns JSON directly: +30
- More than 15 unique review fields: +25
- No token-based authentication: +20
- Pagination support through `page` and `perPage`: +15
- Matches and extends the current review schema: +10

**Total score: 100**

## Candidate Matrix

| Candidate | Header profile or transport | Result | Fields | Pagination | Decision |
|-----------|-----------------------------|--------|--------|------------|----------|
| URLScan result for `www.noon.com` | Public scan lookup | Existing scans found, but the selected scan-result endpoint returned HTTP 403 | Not available | Not available | Rejected as an inspection source |
| Noon review endpoint | Desktop web headers, no session | HTTP 403 Access Denied | 0 | `page`, `perPage` known | Rejected |
| Noon review endpoint | iOS Safari headers, no session | HTTP 403 Access Denied | 0 | `page`, `perPage` known | Rejected |
| Noon review endpoint | Android-style API headers, no session | HTTP 403 Access Denied | 0 | `page`, `perPage` known | Rejected |
| Noon review endpoint | Impit Chrome impersonation, no session | HTTP 403 Access Denied | 0 | `page`, `perPage` known | Rejected |
| Noon review endpoint | Existing browser-assisted session followed by direct JSON requests | HTTP 200, 20 requested reviews saved in 35 seconds | 17 confirmed output fields | `page`, `perPage` | Selected |

## Implementation Decision

The actor already uses the selected JSON endpoint for extraction and pagination. Browser use is limited to establishing the Noon session and collecting the request context that the protected endpoint requires. Review records are collected from JSON responses, not from rendered HTML.

Direct HTTP replay and Impit replay both failed with HTTP 403 without this session state. Replacing the browser-assisted session with an HTTP-only path would therefore reduce reliability, so no transport conversion was made.

## Data Quality Findings

The local run used `productId: N70105592V`, `results_wanted: 20`, `sortFilter: helpful`, and `locale: en-ae`.

- Records saved: 20 of 20 requested
- Duplicate groups: 0
- Explicit null values: 0
- Blank-string values: 0
- `createdAt`: absent in all 20 records because the source response did not supply it
- `imageUrlsV2`: supplied in all 20 records and contains full image URLs when review images exist

`createdAt` remains optional in the output. The actor does not synthesize missing source timestamps.
