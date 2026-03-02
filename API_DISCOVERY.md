## Selected API

- Endpoint: `https://www.noon.com/_vs/mp/mp-trust-api/product-reviews/sku/list`
- Method: `POST`
- Auth: No bearer token; requires realistic browser headers + storefront locale headers + session cookies
- Pagination: `page` + `perPage`
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
- Fields available in responses (non-exhaustive):
  - `sku`
  - `displayName`
  - `title`
  - `rating`
  - `comment`
  - `titleTranslation`
  - `commentTranslation`
  - `updatedAt`
  - `createdAt`
  - `helpfulCount`
  - `isVerifiedPurchase`
  - `imageUrls`
  - `productGroupVariant`
  - `total` (pagination metadata)
  - plus additional dynamic keys preserved by pass-through mapping
- Fields currently missing in actor:
  - No critical review fields missing from this endpoint; actor already preserves unknown non-empty keys dynamically.

## Endpoint Scoring

- Returns JSON directly: +30
- More than 15 unique fields (including dynamic keys and metadata): +25
- No token-based auth: +20
- Pagination support (`page`, `perPage`): +15
- Matches and extends existing review schema: +10

**Total score: 100**
