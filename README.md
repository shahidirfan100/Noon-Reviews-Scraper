# Noon Reviews Scraper

Scrape comprehensive customer reviews and ratings from Noon.com products. Perfect for market research, competitor analysis, and sentiment evaluation.

## Features

- **Extract Comprehensive Details:** Gathers reviewer name, exact star rating, absolute date, review text, and verifying purchase status.
- **Richer Metadata:** Automatically extracts helpful vote counts, multi-language translated reviews, user-uploaded review images, and the exact product variant (Color, Storage, etc.) the customer purchased.
- **Handling Anti-Bot Measures:** Bypasses basic bot protections automatically, ensuring reliable data extraction.
- **Versatile Input:** Accepts either a direct `productId` or a direct URL to the reviews page. Can also configure regional storefronts and sorting methods.
- **Limit Controls:** Configure the exact maximum number of reviews (`results_wanted`) you wish to extract.

## Use Cases

- **E-commerce Analytics:** Understand customer satisfaction and pain points for various products and exact variants.
- **Competitor Analysis:** Scrape reviews of competing products to identify market advantages.
- **Sentiment Analysis:** Feed extracted review text (or their English translations) into AI models to gauge overall customer feeling.
- **Product Research:** Identify common defects or highly praised features for R&D purposes.

---

## Input Parameters

The scraper accepts the following parameters via JSON:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | `String` | The Noon product ID (e.g. `N70105592V`). |
| `startUrl` | `String` | Alternative to `productId`. The full Noon product URL. |
| `results_wanted` | `Integer` | The maximum number of reviews to extract (Default: 20). |
| `sortFilter` | `String` | How to sort the reviews (helpful, newest, highest_rating, lowest_rating). |
| `locale` | `String` | The regional storefront language code (e.g., en-ae, ar-sa). |
| `proxyConfiguration` | `Object` | Apify proxy settings. Residential proxies are heavily recommended. |

## Output Data

Data is stored in the Apify dataset in JSON format containing the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | `String` | The overall ID of the targeted product. |
| `variantSku` | `String` | The specific variant SKU that the user purchased and reviewed. |
| `title` | `String` | The title or headline of the review. |
| `author` | `String` | The display name of the reviewer. |
| `rating` | `Number` | The star rating given out of 5. |
| `reviewText` | `String` | The descriptive body of the review. |
| `titleTranslation` | `String` | A machine English translation of the review title (if applicable). |
| `reviewTextTranslation` | `String` | A machine English translation of the review body (if applicable). |
| `date` | `String` | When the review was last updated. |
| `createdAt` | `String` | The exact timestamp of when the review was created. |
| `helpfulCount` | `Number` | The number of times this review was voted as helpful. |
| `verifiedPurchase` | `Boolean` | True if the purchase was verified by Noon. |
| `imageUrls` | `Array` | A list of URLs pointing to images uploaded by the reviewer. |
| `variant` | `Array` | Characteristics of the purchased variant (e.g., Color, Memory). |

---

## Usage Examples

Here is an example of the `INPUT.json` configuration:

```json
{
  "productId": "N70105592V",
  "results_wanted": 20,
  "sortFilter": "helpful",
  "locale": "en-ae",
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Sample Output

```json
{
  "productId": "N70105592V",
  "variantSku": "N70105592V",
  "author": "Ahmed K.",
  "title": "Excellent quality for the price",
  "rating": 5,
  "reviewText": "I genuinely loved the design and the battery life is amazing.",
  "titleTranslation": "Excellent quality for the price",
  "reviewTextTranslation": "I genuinely loved the design and the battery life is amazing.",
  "date": "2023-10-24T12:00:00.000Z",
  "createdAt": "2023-10-23T10:00:00.000Z",
  "helpfulCount": 12,
  "verifiedPurchase": true,
  "imageUrls": [
    "https://f.nooncdn.com/reviews/image1.jpg"
  ],
  "variant": [
    { "name": "Color", "value": "Titanium Black" },
    { "name": "Memory", "value": "256GB" }
  ]
}
```

---

## Tips

- **Proxies:** Noon.com actively blocks datacenter IP addresses. Please ensure you are utilizing Residential Proxies within your `proxyConfiguration`.
- **Targeting:** Provide only the `productId` if you want a reliable fallback.

## FAQ

**Does this scraper run in the background?**
Yes, it operates fully in the background automatically paginating through the review sections.

**Can I scrape thousands of reviews at once?**
Yes, but you will be reliant on your proxy connection remaining intact. Setting a generous timeout and maximum retry limit might be beneficial.

## Legal Notice

Data collected by this Scraper is publicly accessible. You are responsible for ensuring that your use of the Scraped Data complies with all applicable local and international laws, including data privacy requirements.
