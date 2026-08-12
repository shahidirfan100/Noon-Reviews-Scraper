## What does Noon Reviews Scraper do?

Noon Reviews Scraper collects public customer reviews from Noon.com product pages and saves each review as a structured dataset item. Provide a Noon product ID such as `N70105592V` or a complete product/reviews URL, then choose the number of reviews, review order, and regional locale.

The Noon reviews data includes ratings, review titles, written feedback, reviewer names, verified-purchase status, helpful votes, review images, translations, timestamps, and purchased product variants. You can also opt in to one separate aggregate-rating item when Noon publishes it. Use the results for product research, competitor monitoring, customer feedback analysis, sentiment workflows, catalog enrichment, or AI and reporting pipelines.

## Why use Noon Reviews Scraper?

- **Collect customer feedback at scale** - Gather up to 1,000 reviews for a product in one run instead of copying reviews manually.
- **Analyze product quality** - Compare star ratings, review text, verified purchases, helpful votes, and variant-level feedback.
- **Support regional research** - Select a Noon storefront locale such as UAE English, UAE Arabic, or Saudi Arabia English.
- **Prioritize useful reviews** - Sort results by helpfulness, newest reviews, highest ratings, or lowest ratings.
- **Prepare data for analysis** - Download JSON, CSV, Excel, XML, and other Apify dataset formats after the run.
- **Automate repeat collection** - Schedule runs, connect webhooks, or retrieve results through the Apify API for monitoring and downstream workflows.

## What data can you extract from Noon.com reviews?

Each dataset item represents one customer review. Fields that are not published for a particular review may be omitted or empty.

| Field | Type | Description |
|-------|------|-------------|
| `productId` | String | Noon product ID used for the run. |
| `variantSku` | String | SKU of the product variant associated with the review. |
| `title` | String | Review title or headline. |
| `author` | String | Reviewer display name when available. |
| `rating` | Number | Star rating, normally from 1 to 5. |
| `reviewText` | String | Original written review text. |
| `titleTranslation` | String | English translation of the review title when supplied by Noon. |
| `reviewTextTranslation` | String | English translation of the review text when supplied by Noon. |
| `date` | String | Last-updated date for the review. |
| `createdAt` | String | Review creation timestamp. |
| `helpfulCount` | Number | Number of helpful votes recorded for the review. |
| `verifiedPurchase` | Boolean | Whether Noon marks the review as a verified purchase. |
| `imageUrls` | Array | Image identifiers supplied with the review. |
| `imageUrlsV2` | Array | Full URLs for images uploaded with the review, when available. |
| `variant` | Array | Purchased variant attributes, such as color, storage, or memory. |
| `showTranslateBtn` | Boolean | Whether Noon shows a translation option for the review. |
| `language` | String | Language of the published review. |
| `uid` | String | Source identifier for the review. |
| `recordType` | String | `rating_summary` for the optional aggregate-rating item. |
| `ratingSummary` | Object | Noon-published rating count, average rating, or star breakdown when available. |

## How to use Noon Reviews Scraper

1. Open Noon Reviews Scraper in the Apify Console.
2. Enter a Noon `productId` or a complete `startUrl`. At least one of these values is needed. When both are supplied, the URL takes priority.
3. Set `results_wanted` and choose the desired `sortFilter` and `locale`.
4. Keep the default Apify residential proxy configuration for larger or recurring runs, or provide your own supported proxy settings.
5. Start the run and inspect the dataset preview.
6. Download the review data or connect the dataset to a spreadsheet, webhook, automation, or API workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `productId` | String | No* | `N70105592V` | Noon product ID, for example `N70105592V`. Used unless `startUrl` is supplied. |
| `startUrl` | String | No* | - | Full Noon product or reviews URL. The Actor opens this exact URL and it takes priority over `productId`. |
| `results_wanted` | Integer | No | `20` | Maximum number of written reviews to save, up to `1,000`. |
| `includeRatingSummary` | Boolean | No | `false` | Add one `rating_summary` item when Noon publishes aggregate rating data. It does not create individual reviews for rating-only submissions. |
| `sortFilter` | String | No | `helpful` | Review order: `helpful`, `newest`, `highest_rating`, or `lowest_rating`. |
| `locale` | String | No | `en-ae` | Language and country code, such as `en-ae`, `ar-ae`, or `en-sa`. |
| `proxyConfiguration` | Object | No | Apify residential proxy | Apify Proxy settings for reliable collection. |

\* Provide either `productId` or `startUrl`. If both are provided, `startUrl` identifies the product to collect.

### Locale examples

The locale controls the Noon regional storefront and review language used for the run. Common values include:

| Locale | Storefront use |
|--------|----------------|
| `en-ae` | UAE storefront in English |
| `ar-ae` | UAE storefront in Arabic |
| `en-sa` | Saudi Arabia storefront in English |
| `ar-sa` | Saudi Arabia storefront in Arabic |

## Output Data

The Actor writes review records to the default Apify dataset. The primary output fields are:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | String | Target product ID. |
| `variantSku` | String | Reviewed product variant SKU. |
| `title` | String | Customer review headline. |
| `author` | String | Customer display name. |
| `rating` | Number | Customer rating out of five. |
| `reviewText` | String | Original customer feedback. |
| `titleTranslation` | String | Translated review title, when available. |
| `reviewTextTranslation` | String | Translated review body, when available. |
| `date` | String | Review update date. |
| `createdAt` | String | Review creation timestamp. |
| `helpfulCount` | Number | Helpful-vote total. |
| `verifiedPurchase` | Boolean | Verified-purchase indicator. |
| `imageUrls` | Array | Review image identifiers. |
| `imageUrlsV2` | Array | Full review image URLs, when supplied. |
| `variant` | Array | Variant name and value pairs, when published. |
| `showTranslateBtn` | Boolean | Translation-option indicator. |
| `language` | String | Published review language. |
| `uid` | String | Source review identifier. |
| `recordType` | String | `rating_summary` for the optional aggregate-rating item. |
| `ratingSummary` | Object | Noon-published rating count, average rating, or star breakdown when available. |

## Usage Examples

### Basic extraction by product ID

Collect the 20 most helpful reviews for a known Noon product:

```json
{
  "productId": "N70105592V",
  "results_wanted": 20,
  "sortFilter": "helpful",
  "locale": "en-ae"
}
```

### Extraction from a reviews URL

Use a complete Noon reviews URL when you already have a product page link:

```json
{
  "startUrl": "https://www.noon.com/uae-en/reviews/N70105592V/",
  "results_wanted": 50,
  "includeRatingSummary": true,
  "sortFilter": "newest",
  "locale": "en-ae"
}
```

### Filtered regional review collection

Collect a larger set of low-rated reviews from the Saudi Arabic storefront for quality and product-improvement analysis:

```json
{
  "productId": "N70105592V",
  "results_wanted": 200,
  "sortFilter": "lowest_rating",
  "locale": "ar-sa",
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Sample Output

Each regular dataset item represents one Noon customer review. When `includeRatingSummary` is enabled, the Actor may add one separate `rating_summary` item for ratings that have no individual written-review record. The following example shows the main review fields that may be returned:

```json
{
  "productId": "N70105592V",
  "variantSku": "N70105592V-11",
  "title": "Excellent quality for the price",
  "author": "Ahmed K.",
  "rating": 5,
  "reviewText": "I genuinely loved the design and the battery life is amazing.",
  "titleTranslation": "Excellent quality for the price",
  "reviewTextTranslation": "I genuinely loved the design and the battery life is amazing.",
  "date": "2026-07-24T12:00:00.000Z",
  "createdAt": "2026-07-23T10:00:00.000Z",
  "helpfulCount": 12,
  "verifiedPurchase": true,
  "imageUrls": [
    "a151a806-2475-41de-912d-a8ef53a58a63-1749016299-1.png"
  ],
  "imageUrlsV2": [
    "https://f.nooncdn.com/review/a151a806-2475-41de-912d-a8ef53a58a63-1749016299-1.png"
  ],
  "variant": [
    { "name": "Color", "value": "Titanium Black" },
    { "name": "Memory", "value": "256GB" }
  ],
  "showTranslateBtn": false,
  "language": "en",
  "uid": "008ead34-9a94-450e-a659-6b7e22db3fdd"
}
```

## Tips for Best Results

- **Start with the product ID** - Use `productId` when you already know the Noon SKU. It is the simplest input and avoids errors from malformed URLs.
- **Test with a small limit** - Begin with `results_wanted` set to `20` or `50`, confirm the product and fields, then increase the limit.
- **Choose the right sort order** - Use `helpful` for representative feedback, `newest` for recent monitoring, and rating-specific options for quality analysis.
- **Match the locale to the storefront** - Use the country and language that correspond to the Noon product page you want to analyze.
- **Use residential proxies for larger runs** - Residential Apify Proxy is recommended for high-volume, scheduled, or repeated collection.
- **Expect source-dependent fields** - Not every review includes a title, translation, image, variant, helpful count, or verified-purchase flag. Missing values generally reflect what Noon publishes.
- **Check the dataset preview** - Review several records before scheduling a large run or sending the data to a sentiment-analysis workflow.

## Integrations and Export Formats

| Integration or format | Use |
|------------------------|-----|
| JSON | Feed review records into applications, AI workflows, and custom analysis. |
| CSV or Excel | Share feedback with product, research, and customer-support teams. |
| Google Sheets or Airtable | Filter, annotate, and compare review datasets. |
| Webhooks | Notify another service when a run finishes. |
| Make or Zapier | Send review records into alerts, dashboards, and business workflows. |
| Apify API | Start runs and retrieve dataset items programmatically. |

## Frequently Asked Questions

### Can I collect reviews from a Noon product URL?

Yes. Put a complete Noon product or reviews URL in `startUrl`. The Actor opens the URL directly.

### Can I collect thousands of Noon reviews?

The Actor saves up to `1,000` reviews per run. Start with a smaller limit to validate the product and locale before running a larger collection.

### Can I sort Noon reviews by rating or date?

Yes. Use `helpful`, `newest`, `highest_rating`, or `lowest_rating` in `sortFilter`.

### Does the Actor support multiple Noon countries and languages?

Yes. Set `locale` to a supported language-country value such as `en-ae`, `ar-ae`, `en-sa`, or `ar-sa` to target the corresponding Noon storefront.

### Why are some review fields missing?

Fields may be missing because Noon does not publish every value for every review. Check several records before treating an absent title, image, translation, variant, or vote count as an extraction problem.

### Can I export Noon reviews to CSV or Excel?

Yes. Apify dataset results can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

### Can I schedule recurring review collection?

Yes. Create an Apify schedule to run the Actor hourly, daily, weekly, or at another interval, then compare datasets over time.

### Is collecting Noon reviews legal?

You are responsible for using the Actor lawfully. Review Noon’s terms, applicable privacy and data-protection requirements, and any restrictions that apply to your use case. Collect only the public data you need and use it responsibly.

## Related Actors

- [Noon.com Product Scraper](https://apify.com/shahidirfan/noon-com-scraper) - Collect Noon product listings, prices, ratings, seller details, discounts, and product links.
- [Trendyol Reviews Scraper ⭐](https://apify.com/shahidirfan/trendyol-reviews-scraper) - Collect product reviews, ratings, review text, helpful votes, and variant details from Trendyol.
- [Sephora Scraper](https://apify.com/shahidirfan/sephora-scraper) - Collect ecommerce product details, prices, ratings, review counts, availability, and product links from Sephora.

## Support

For bugs, feature requests, or questions about a run, use the Issues tab on the Actor page. Include the input configuration and run details when reporting a reproducible problem.

## Legal Notice

This Actor is intended for legitimate collection of publicly available Noon review data. Users are responsible for complying with Noon’s terms of service, applicable laws, privacy obligations, and restrictions connected with the data they collect. Do not use the output for unlawful discrimination, harassment, spam, or other harmful activity.
