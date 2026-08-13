import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { chromium } from 'patchright';

const API_URL = 'https://www.noon.com/_vs/mp/mp-trust-api/product-reviews/sku/list';
const PER_PAGE = 15;
const MAX_RESULTS_WANTED = 1000;
const MAX_HTTP_ATTEMPTS = 3;
const MAX_BROWSER_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_SORT_FILTERS = new Set(['helpful', 'newest', 'highest_rating', 'lowest_rating']);
const REVIEW_API_PATTERNS = [
    /\/product-reviews\/sku\/list/i,
    /mp-trust-api.*review/i,
    /\/reviews\/sku\//i,
];
const RATING_SUMMARY_API_PATTERN = /\/product-ratings\/sku\//i;
const describeError = (error) => {
    const message = String(error?.message || error || 'Unknown error')
        .replace(/https?:\/\/[^\s]+/gi, '[URL]')
        .replace(/(cookie|token|authorization)\s*[:=]\s*[^,\s]+/gi, '$1=[redacted]');
    return message.slice(0, 250);
};

const parseLocale = (localeValue) => {
    const raw = String(localeValue || '').toLowerCase().trim();
    const [first = 'en', second = 'ae'] = raw.split('-');
    const countryAliases = {
        uae: { code: 'ae', slug: 'uae' },
        saudi: { code: 'sa', slug: 'saudi' },
        ksa: { code: 'sa', slug: 'saudi' },
        egypt: { code: 'eg', slug: 'egypt' },
    };
    const countrySlugByCode = {
        ae: 'uae',
        sa: 'saudi',
        eg: 'egypt',
        kw: 'kuwait',
        bh: 'bahrain',
        om: 'oman',
        qa: 'qatar',
    };

    if (first.length === 2 && second.length === 2) {
        const lang = first;
        const country = second;
        const normalizedLocale = `${lang}-${country}`;
        const siteLocale = `${countrySlugByCode[country] || country}-${lang}`;
        return { lang, country, normalizedLocale, siteLocale };
    }
    if (countryAliases[first] && second.length === 2) {
        const lang = second;
        const country = countryAliases[first].code;
        return {
            lang,
            country,
            normalizedLocale: `${lang}-${country}`,
            siteLocale: `${countryAliases[first].slug}-${lang}`,
        };
    }
    if (countryAliases[second] && first.length === 2) {
        const lang = first;
        const country = countryAliases[second].code;
        return {
            lang,
            country,
            normalizedLocale: `${lang}-${country}`,
            siteLocale: `${countryAliases[second].slug}-${lang}`,
        };
    }
    return { lang: 'en', country: 'ae', normalizedLocale: 'en-ae', siteLocale: 'uae-en' };
};

const normalizeNoonUrl = (value) => {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error('startUrl must be a valid Noon product or reviews URL.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || !/(^|\.)noon\.com$/i.test(parsed.hostname)) {
        throw new Error('startUrl must use a Noon.com domain.');
    }

    return parsed.toString();
};

const getLocaleFromNoonUrl = (value) => {
    const firstPathSegment = new URL(value).pathname.split('/').filter(Boolean)[0] || '';
    if (!/^(?:uae|saudi|egypt|kuwait|bahrain|oman|qatar)-(?:en|ar)$/i.test(firstPathSegment)) {
        return null;
    }
    return parseLocale(firstPathSegment);
};

const sanitizeRequestHeaders = (headers) => {
    const blocked = new Set([
        'host',
        'content-length',
        'connection',
        'accept-encoding',
        'transfer-encoding',
        'user-agent',
    ]);
    const clean = {};
    for (const [key, value] of Object.entries(headers || {})) {
        const lower = key.toLowerCase();
        if (!blocked.has(lower) && value) clean[lower] = value;
    }
    return clean;
};

const sanitizeBrowserFetchHeaders = (headers) => {
    const forbidden = new Set([
        'cookie',
        'user-agent',
        'content-length',
        'host',
        'connection',
        'accept-encoding',
    ]);
    const clean = {};
    for (const [key, value] of Object.entries(headers || {})) {
        const lower = key.toLowerCase();
        if (!forbidden.has(lower) && value) clean[lower] = value;
    }
    return clean;
};

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const hasAccessDeniedMarker = (text) => /access denied/i.test(String(text || ''));

const parseProxyForBrowser = (proxyUrl) => {
    if (!proxyUrl) return undefined;
    try {
        const parsed = new URL(proxyUrl);
        const username = decodeURIComponent(parsed.username || '');
        const password = decodeURIComponent(parsed.password || '');
        return {
            server: `${parsed.protocol}//${parsed.host}`,
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
        };
    } catch {
        return undefined;
    }
};

const buildPayload = ({ sku, lang, sortFilter, page, perPage, payloadTemplate }) => {
    const base = payloadTemplate && typeof payloadTemplate === 'object'
        ? structuredClone(payloadTemplate)
        : {};

    base.sku = sku;
    base.lang = lang;
    base.ratings = Array.isArray(base.ratings) && base.ratings.length > 0 ? base.ratings : [1, 2, 3, 4, 5];
    base.provideBreakdown = page === 1;
    base.page = page;
    base.perPage = perPage;
    base.sortFilter = sortFilter;
    base.imagesFilter = typeof base.imagesFilter === 'boolean' ? base.imagesFilter : false;
    base.grouped = typeof base.grouped === 'boolean' ? base.grouped : true;
    base.verifiedPurchase = typeof base.verifiedPurchase === 'boolean' ? base.verifiedPurchase : false;

    return base;
};

const mapReviews = ({ items, productId }) => {
    const knownKeys = new Set([
        'sku',
        'displayName',
        'title',
        'rating',
        'comment',
        'titleTranslation',
        'commentTranslation',
        'updatedAt',
        'createdAt',
        'helpfulCount',
        'isVerifiedPurchase',
        'imageUrls',
        'productGroupVariant',
    ]);

    return items.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = { productId };

        if (item.sku != null) record.variantSku = item.sku;
        if (item.displayName != null) record.author = item.displayName;
        if (item.title != null) record.title = item.title;
        if (item.rating != null) record.rating = item.rating;
        if (item.comment != null) record.reviewText = item.comment;
        if (item.titleTranslation != null) record.titleTranslation = item.titleTranslation;
        if (item.commentTranslation != null) record.reviewTextTranslation = item.commentTranslation;
        if (item.updatedAt != null) record.date = item.updatedAt;
        if (item.createdAt != null) record.createdAt = item.createdAt;
        if (item.helpfulCount != null) record.helpfulCount = item.helpfulCount;
        if (item.isVerifiedPurchase != null) record.verifiedPurchase = item.isVerifiedPurchase;
        if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) record.imageUrls = item.imageUrls;
        if (Array.isArray(item.productGroupVariant) && item.productGroupVariant.length > 0) {
            record.variant = item.productGroupVariant;
        }

        for (const [key, value] of Object.entries(item)) {
            if (!knownKeys.has(key) && value !== null && value !== undefined && value !== '') {
                record[key] = value;
            }
        }

        return [record];
    });
};

const normalizeResponseBody = (body) => {
    if (typeof body === 'string') return body;
    if (body === null || body === undefined) return '';
    if (typeof body === 'object') return JSON.stringify(body);
    return String(body);
};

const safeJsonParse = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const isReviewApiUrl = (url) => REVIEW_API_PATTERNS.some((pattern) => pattern.test(String(url || '')));
const isInternalNoonApiUrl = (url) => String(url || '').includes('www.noon.com/_vs/');
const isRatingSummaryApiUrl = (url) => RATING_SUMMARY_API_PATTERN.test(String(url || ''));

const extractItemsFromApiData = (data) => {
    if (!data) return [];
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.reviews)) return data.reviews;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.result)) return data.result;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data?.payload?.list)) return data.payload.list;
    if (Array.isArray(data?.payload?.reviews)) return data.payload.reviews;
    return [];
};

const buildReviewSignature = (record) => JSON.stringify([
    record.uid ?? '',
    record.variantSku ?? '',
    record.author ?? '',
    record.title ?? '',
    record.reviewText ?? '',
    record.createdAt ?? record.date ?? '',
]);

const getApiReportedTotal = (data) => {
    const candidates = [
        data?.total,
        data?.totalCount,
        data?.reviewCount,
        data?.meta?.total,
        data?.meta?.totalCount,
        data?.pagination?.total,
        data?.pagination?.totalCount,
        data?.pageInfo?.total,
        data?.summary?.total,
        data?.summary?.totalReviews,
    ];
    return candidates.find((value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0);
};

const getRatingSummaryFromApiData = (data) => {
    const candidates = [
        data?.ratingSummary,
        data?.ratingsSummary,
        data?.ratingBreakdown,
        data?.ratingsBreakdown,
        data?.breakdown,
        data?.summary?.ratingSummary,
        data?.summary?.ratingsBreakdown,
        data?.payload?.ratingSummary,
        data?.payload?.ratingsBreakdown,
    ];
    return candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
};

const getRatingSummaryFromPageState = async (page) => page.evaluate(() => {
    const text = document.body?.innerText || '';
    const match = text.match(/(\d(?:[.,]\d)?)\s+(\d[\d,]*)\s+Ratings\b/i)
        || text.match(/(\d(?:[.,]\d)?)\s+(\d[\d,]*)\s+تقييم(?:ات)?\b/i);
    if (!match) return null;

    const averageRating = Number(match[1].replace(',', '.'));
    const ratingCount = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(averageRating) || !Number.isFinite(ratingCount)) return null;
    return { averageRating, ratingCount };
});

await Actor.init();

let browser;
let context;
let page;
let fatalError;

try {
    const input = (await Actor.getInput()) || {};
    const {
        productId,
        startUrl,
        results_wanted = 20,
        sortFilter = 'helpful',
        locale = 'en-ae',
        includeRatingSummary = false,
        proxyConfiguration: proxyConfig,
    } = input;

    const productIdValue = typeof productId === 'string' ? productId.trim() : String(productId || '').trim();
    const startUrlValue = typeof startUrl === 'string' ? startUrl.trim() : '';
    let sku = productIdValue || undefined;
    let inputSource;
    let targetUrl;
    let directUrlLocale;

    if (startUrlValue) {
        targetUrl = normalizeNoonUrl(startUrlValue);
        directUrlLocale = getLocaleFromNoonUrl(targetUrl);
        sku = undefined;
        inputSource = 'startUrl';
    } else if (productIdValue) {
        inputSource = 'productId';
    } else {
        throw new Error('Provide either a Noon product/reviews URL or a Noon product ID.');
    }

    const requestedTotalRaw = Number(results_wanted);
    const requestedTotal = Number.isFinite(requestedTotalRaw) && requestedTotalRaw > 0
        ? Math.min(Math.floor(requestedTotalRaw), MAX_RESULTS_WANTED)
        : 20;
    const shouldIncludeRatingSummary = includeRatingSummary === true;
    const normalizedSortFilter = ALLOWED_SORT_FILTERS.has(sortFilter) ? sortFilter : 'helpful';
    if (normalizedSortFilter !== sortFilter) {
        log.warning(`Invalid sortFilter "${sortFilter}" provided. Falling back to "helpful".`);
    }
    const normalizedInputLocale = String(locale || 'en-ae').toLowerCase();
    const inputLocale = parseLocale(normalizedInputLocale);
    const { lang, country, normalizedLocale, siteLocale } = directUrlLocale || inputLocale;
    if (!targetUrl) targetUrl = `https://www.noon.com/${siteLocale}/reviews/${sku}/`;

    const desiredCountryCode = country.toUpperCase();
    const proxyConfigurationInput = proxyConfig
        ? structuredClone(proxyConfig)
        : { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] };
    if (proxyConfigurationInput.useApifyProxy !== false) {
        if (!Array.isArray(proxyConfigurationInput.apifyProxyGroups) || proxyConfigurationInput.apifyProxyGroups.length === 0) {
            proxyConfigurationInput.apifyProxyGroups = ['RESIDENTIAL'];
        }
        if (!proxyConfigurationInput.countryCode && !proxyConfigurationInput.apifyProxyCountry) {
            proxyConfigurationInput.countryCode = desiredCountryCode;
            proxyConfigurationInput.apifyProxyCountry = desiredCountryCode;
        }
    }
    const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigurationInput);
    if (!proxyConfiguration) {
        log.warning('Proxy configuration unavailable. Continuing without proxy for this run.');
    }
    let sessionProxyUrl;
    let interceptedHeaders;
    let interceptedInternalHeaders;
    let interceptedPayloadTemplate;
    let interceptedApiUrl;
    let interceptedResponseData;
    let interceptedRatingSummaryData;

    log.info(`Starting Noon Reviews Fetcher | source=${inputSource} | target=${requestedTotal}`);
    log.info('Launching stealth Chrome to obtain session and intercept network calls...');

    const launchBrowserAttempt = async (attempt) => {
        sessionProxyUrl = proxyConfiguration
            ? await proxyConfiguration.newUrl(`noon_reviews_${Date.now()}_${attempt}`)
            : undefined;
        const browserProxy = parseProxyForBrowser(sessionProxyUrl);

        context = await chromium.launchPersistentContext('./user_data', {
            channel: 'chrome',
            headless: false,
            noViewport: true,
            ...(browserProxy ? { proxy: browserProxy } : {}),
        });
        page = await context.newPage();

        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type)) return route.abort();
            return route.continue();
        });
        page.on('request', (request) => {
            if (!interceptedInternalHeaders && isInternalNoonApiUrl(request.url()) && request.method() === 'GET') {
                interceptedInternalHeaders = sanitizeRequestHeaders(request.headers());
            }
            if (request.method() === 'POST' && isReviewApiUrl(request.url())) {
                interceptedApiUrl = request.url();
                interceptedHeaders = sanitizeRequestHeaders(request.headers());
                const postData = request.postData();
                const parsedTemplate = typeof postData === 'string' ? safeJsonParse(postData) : null;
                if (parsedTemplate && typeof parsedTemplate === 'object') {
                    interceptedPayloadTemplate = parsedTemplate;
                    if (typeof parsedTemplate.sku === 'string' && parsedTemplate.sku.trim()) {
                        sku = parsedTemplate.sku.trim();
                    }
                }
            }
        });
        page.on('response', async (response) => {
            try {
                if (isRatingSummaryApiUrl(response.url()) && response.status() === 200 && !interceptedRatingSummaryData) {
                    const ratingBody = await response.text();
                    const ratingData = safeJsonParse(ratingBody);
                    if (ratingData) interceptedRatingSummaryData = ratingData;
                    return;
                }
                if (interceptedResponseData) return;
                if (!isReviewApiUrl(response.url())) return;
                if (response.status() !== 200) return;
                const body = await response.text();
                const parsed = safeJsonParse(body);
                if (!parsed) return;
                const items = extractItemsFromApiData(parsed);
                if (!Array.isArray(items) || items.length === 0) return;
                interceptedResponseData = parsed;
            } catch {
                // Ignore transient response parsing errors.
            }
        });
    };

    let pageUrl = targetUrl;
    let pageLoaded = false;
    for (let attempt = 1; attempt <= MAX_BROWSER_ATTEMPTS; attempt += 1) {
        try {
            await launchBrowserAttempt(attempt);
            const pageResponse = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            const status = pageResponse?.status() ?? 0;
            log.info(`Loaded page with status: ${status} (attempt ${attempt}/${MAX_BROWSER_ATTEMPTS})`);

            const htmlPreview = await page.content();
            const blocked = status === 403 || hasAccessDeniedMarker(htmlPreview);
            if (blocked) {
                log.warning(`Attempt ${attempt} was blocked on landing page. Rotating proxy session.`);
                await context?.close().catch(() => undefined);
                await browser?.close().catch(() => undefined);
                context = undefined;
                browser = undefined;
                page = undefined;
                continue;
            }

            await page.waitForTimeout(250);
            pageUrl = page.url() || targetUrl;
            pageLoaded = true;
            break;
        } catch (error) {
            log.warning(`Browser attempt ${attempt}/${MAX_BROWSER_ATTEMPTS} failed: ${describeError(error)}`);
            await context?.close().catch(() => undefined);
            await browser?.close().catch(() => undefined);
            context = undefined;
            browser = undefined;
            page = undefined;
        }
    }
    if (!pageLoaded || !page) {
        throw new Error('Failed to load Noon page without Access Denied after multiple proxy session attempts. Try Apify residential proxy in the target country.');
    }

    const resolveSkuFromLoadedPage = async () => page.evaluate(() => {
        const candidates = [
            window.location.href,
            document.querySelector('link[rel="canonical"]')?.href,
            document.querySelector('meta[property="og:url"]')?.content,
        ].filter(Boolean);

        for (const candidate of candidates) {
            // Noon product identifiers use more than one prefix, including N and Z.
            // Resolve only from the page that was already opened, never from raw input.
            const match = String(candidate).match(/\/([A-Z][A-Z0-9-]{5,})(?:\/|$|\?)/);
            if (match) return match[1];
        }
        return null;
    });

    if (!sku) {
        sku = await resolveSkuFromLoadedPage();
        if (sku) log.info('Resolved the review target from the loaded Noon page.');
    }

    const warmUpReviewSession = async ({ retry = false } = {}) => {
        log.info(retry
            ? 'Refreshing Noon review session after a protected API response.'
            : 'Preparing Noon review session before the first review request.');

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(750);
        await page.evaluate(() => window.scrollTo(0, 0));

        const reviewSelectors = [
            'a[href*="/reviews/"]',
            '[data-qa*="review"]',
            '[data-testid*="review"]',
            'button:has-text("Reviews")',
            'button:has-text("reviews")',
        ];

        for (const selector of reviewSelectors) {
            const locator = page.locator(selector).first();
            try {
                if (await locator.count()) {
                    await locator.click({ timeout: 2000 });
                    await page.waitForTimeout(1200);
                    break;
                }
            } catch {
                // Continue with the current session if a visual control is unavailable.
            }
        }

        await page.waitForTimeout(1800);
        pageUrl = page.url() || pageUrl;
    };

    // Noon often rejects a brand-new session's first replayed request. Warm the live page first so
    // successful runs do not begin with a recoverable 403 in the log.
    let sessionWarmUpUsed = false;
    let sessionRefreshRetried = false;
    if (sku && !interceptedResponseData) {
        sessionWarmUpUsed = true;
        await warmUpReviewSession();
    }

    const getCookieHeader = async () => {
        const cookies = await context.cookies();
        return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    };

    const fetchPageInBrowser = async ({ apiUrl, payload, baseHeaders }) => {
        const browserHeaders = sanitizeBrowserFetchHeaders(baseHeaders);
        const response = await page.evaluate(
            async ({ requestUrl, headers, requestBody }) => {
                try {
                    const result = await fetch(requestUrl, {
                        method: 'POST',
                        credentials: 'include',
                        headers,
                        body: JSON.stringify(requestBody),
                    });
                    return {
                        statusCode: result.status,
                        body: await result.text(),
                    };
                } catch (error) {
                    return {
                        statusCode: 0,
                        body: error?.message || 'Browser fetch failed',
                    };
                }
            },
            { requestUrl: apiUrl, headers: browserHeaders, requestBody: payload },
        );
        return response;
    };

    const fetchPageWithHttp = async ({ apiUrl, payload, headers }) => {
        for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt += 1) {
            try {
            const response = await gotScraping.post(apiUrl, {
                proxyUrl: sessionProxyUrl,
                http2: false,
                useHeaderGenerator: false,
                headers,
                    json: payload,
                    timeout: { request: 30000 },
                });
                return { statusCode: response.statusCode, body: response.body };
            } catch (error) {
                const statusCode = error.response?.statusCode || 0;
                const body = error.response?.body || error.message;
                const shouldRetry = (RETRYABLE_STATUS_CODES.has(statusCode) && statusCode !== 403) || statusCode === 0;

                if (!shouldRetry || attempt === MAX_HTTP_ATTEMPTS) {
                    return { statusCode, body };
                }

                const waitMs = attempt * 1500;
                log.warning(`HTTP request ${attempt}/${MAX_HTTP_ATTEMPTS} failed with ${statusCode}: ${describeError(error)}. Retrying in ${waitMs}ms.`);
                await sleep(waitMs);
            }
        }
        return { statusCode: 0, body: 'HTTP request retries exhausted.' };
    };

    const extractReviewsFromPageState = async ({ maxItems }) => {
        const result = await page.evaluate(({ maxResults }) => {
            const safeParseJson = (text) => {
                if (!text) return null;
                try {
                    return JSON.parse(text);
                } catch {
                    return null;
                }
            };

            const isReviewObject = (value) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
                const hasRating = value.rating != null || value.score != null || value.stars != null;
                const hasReviewText = value.comment != null
                    || value.reviewText != null
                    || value.review != null
                    || value.title != null;
                const hasAuthor = value.displayName != null
                    || value.author != null
                    || value.userName != null
                    || value.name != null;
                return hasRating && (hasReviewText || hasAuthor);
            };

            const roots = [];

            const nextData = safeParseJson(document.querySelector('#__NEXT_DATA__')?.textContent || '');
            if (nextData) roots.push({ source: '__NEXT_DATA__', value: nextData });

            const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const script of jsonLdScripts) {
                const parsed = safeParseJson(script.textContent || '');
                if (parsed) roots.push({ source: 'json-ld', value: parsed });
            }

            // eslint-disable-next-line no-underscore-dangle
            if (window.__INITIAL_STATE__) roots.push({ source: '__INITIAL_STATE__', value: window.__INITIAL_STATE__ });
            // eslint-disable-next-line no-underscore-dangle
            if (window.__PRELOADED_STATE__) roots.push({ source: '__PRELOADED_STATE__', value: window.__PRELOADED_STATE__ });

            const queue = [...roots];
            const seenObjects = new WeakSet();
            const seenReviews = new Set();
            const found = [];
            const maxNodes = 25000;
            let nodesVisited = 0;

            while (queue.length > 0 && found.length < maxResults && nodesVisited < maxNodes) {
                const current = queue.shift();
                nodesVisited += 1;
                const node = current?.value;

                if (!node || typeof node !== 'object') continue;
                if (seenObjects.has(node)) continue;
                seenObjects.add(node);

                if (Array.isArray(node)) {
                    for (const item of node) {
                        if (isReviewObject(item)) {
                            const signature = JSON.stringify([
                                item.sku ?? '',
                                item.displayName ?? item.author ?? item.userName ?? '',
                                item.title ?? '',
                                item.comment ?? item.reviewText ?? item.review ?? '',
                                item.rating ?? item.score ?? item.stars ?? '',
                            ]);
                            if (!seenReviews.has(signature)) {
                                seenReviews.add(signature);
                                found.push(item);
                                if (found.length >= maxResults) break;
                            }
                        }

                        if (item && typeof item === 'object') {
                            queue.push({ source: current.source, value: item });
                        }
                    }
                    continue;
                }

                for (const child of Object.values(node)) {
                    if (child && typeof child === 'object') {
                        queue.push({ source: current.source, value: child });
                    }
                }
            }

            return {
                items: found.slice(0, maxResults),
                visitedNodes: nodesVisited,
                rootsChecked: roots.length,
            };
        }, { maxResults: maxItems });

        return result;
    };

    let totalSaved = 0;
    let pageNumber = 1;
    let useBrowserFallback = false;
    let apiUrl = interceptedApiUrl || API_URL;
    let duplicatePageStreak = 0;
    let apiReportedTotal;
    let stopReason = 'requested limit reached';
    let ratingSummarySaved = false;
    const savedReviewSignatures = new Set();

    const pushRatingSummary = async (apiData) => {
        if (!shouldIncludeRatingSummary || ratingSummarySaved) return false;

        const ratingSummary = getRatingSummaryFromApiData(apiData)
            || getRatingSummaryFromApiData(interceptedRatingSummaryData);
        if (!ratingSummary) return false;

        await Dataset.pushData({
            recordType: 'rating_summary',
            productId: sku,
            ratingSummary,
        });
        ratingSummarySaved = true;
        log.info('Saved Noon rating summary.');
        return true;
    };

    const requestReviewPage = async ({ requestApiUrl, payload }) => {
        const cookieHeader = await getCookieHeader();
        const baseHeaders = {
            accept: 'application/json, text/plain, */*',
            'accept-language': `${lang}-${country},${lang};q=0.9,en;q=0.8`,
            'content-type': 'application/json',
            origin: 'https://www.noon.com',
            referer: pageUrl,
            'x-platform': 'web',
            'x-locale': normalizedLocale,
            'x-mp-country': country,
            'x-content': 'desktop',
            'x-cms': 'v2',
            ...(interceptedInternalHeaders || {}),
            ...(interceptedHeaders || {}),
            cookie: cookieHeader,
        };

        let response = useBrowserFallback
            ? await fetchPageInBrowser({ apiUrl: requestApiUrl, payload, baseHeaders })
            : await fetchPageWithHttp({ apiUrl: requestApiUrl, payload, headers: baseHeaders });

        if (!useBrowserFallback && response.statusCode !== 200) {
            log.warning(`HTTP request blocked with ${response.statusCode}. Switching to browser-context fetch.`);
            useBrowserFallback = true;
            response = await fetchPageInBrowser({ apiUrl: requestApiUrl, payload, baseHeaders });
        }
        return response;
    };

    const pushUniqueReviews = async (items, sourceLabel) => {
        const remaining = requestedTotal - totalSaved;
        if (remaining <= 0) return 0;

        const mapped = mapReviews({ items, productId: sku });
        const unique = mapped.filter((record) => {
            const signature = buildReviewSignature(record);
            if (savedReviewSignatures.has(signature)) return false;
            savedReviewSignatures.add(signature);
            return true;
        });
        const limited = unique.slice(0, remaining);

        if (limited.length > 0) {
            await Dataset.pushData(limited);
            totalSaved += limited.length;
            log.info(`Saved ${limited.length} items from ${sourceLabel}. Total: ${totalSaved}/${requestedTotal}`);
        }
        return limited.length;
    };

    if (interceptedResponseData) {
        const interceptedItems = extractItemsFromApiData(interceptedResponseData);
        await pushRatingSummary(interceptedResponseData);
        if (interceptedItems.length > 0) {
            await pushUniqueReviews(interceptedItems, 'intercepted browser response');
            pageNumber = 2;
        }
    }

    if (!sku) {
        log.warning('The supplied URL did not trigger a usable Noon reviews request. Skipping API pagination and checking page state.');
    }

    while (sku && totalSaved < requestedTotal) {
        if (interceptedApiUrl) apiUrl = interceptedApiUrl;
        const requestedPerPage = PER_PAGE;
        const payload = buildPayload({
            sku,
            lang,
            sortFilter: normalizedSortFilter,
            page: pageNumber,
            perPage: requestedPerPage,
            payloadTemplate: interceptedPayloadTemplate,
        });

        log.info(`API request | page=${pageNumber} | batch=${requestedPerPage} | remaining=${requestedTotal - totalSaved}`);

        let response = await requestReviewPage({ requestApiUrl: apiUrl, payload });
        if (response.statusCode === 403 && !sessionRefreshRetried) {
            sessionWarmUpUsed = true;
            sessionRefreshRetried = true;
            await warmUpReviewSession({ retry: true });
            useBrowserFallback = false;
            log.info('Review session refreshed. Retrying the protected API request.');
            response = await requestReviewPage({ requestApiUrl: apiUrl, payload });
        }

        if (response.statusCode !== 200) {
            if (useBrowserFallback && response.statusCode === 0) {
                log.warning(`Browser-context request failed: ${describeError(response.body)}`);
            }
            log.error(`API request returned status ${response.statusCode}.`);
            break;
        }

        let data;
        try {
            const rawBody = normalizeResponseBody(response.body);
            data = JSON.parse(rawBody);
        } catch {
            log.error(`Invalid JSON response on page ${pageNumber}.`);
            break;
        }

        const items = extractItemsFromApiData(data);
        await pushRatingSummary(data);
        const currentApiTotal = getApiReportedTotal(data);
        if (currentApiTotal !== undefined) apiReportedTotal = Number(currentApiTotal);
        if (!Array.isArray(items) || items.length === 0) {
            if (apiReportedTotal !== undefined && totalSaved < apiReportedTotal) {
                log.warning(`Noon returned no more review records after ${totalSaved}, although its response reported ${apiReportedTotal}.`);
            }
            log.info('No more reviews returned. Stopping pagination.');
            stopReason = 'No more reviews returned by Noon';
            break;
        }

        const savedNow = await pushUniqueReviews(items, 'API pagination');
        if (savedNow === 0) {
            duplicatePageStreak += 1;
            if (duplicatePageStreak >= 2) {
                log.info('Received duplicate-only pages twice in a row. Stopping pagination.');
                stopReason = 'Two duplicate-only pages returned by Noon';
                break;
            }
            log.info('Received duplicate-only page. Continuing to next page.');
            pageNumber += 1;
            continue;
        }
        duplicatePageStreak = 0;

        if (apiReportedTotal !== undefined && totalSaved >= apiReportedTotal) {
            log.info(`All ${apiReportedTotal} reviews reported by Noon were fetched.`);
            stopReason = 'Reached Noon-reported review total';
            break;
        }

        if (items.length < requestedPerPage) {
            log.info(`Short batch (${items.length}/${requestedPerPage}). Checking the next page before stopping.`);
        }

        pageNumber += 1;
    }

    if (totalSaved === 0) {
        const pageStateResult = await extractReviewsFromPageState({ maxItems: requestedTotal });
        if (Array.isArray(pageStateResult.items) && pageStateResult.items.length > 0) {
            await pushUniqueReviews(pageStateResult.items, 'page state fallback');
            log.info(`Page state fallback scanned ${pageStateResult.rootsChecked} roots, ${pageStateResult.visitedNodes} nodes.`);
        } else {
            log.warning('Page state fallback did not find review items.');
        }
    }

    if (shouldIncludeRatingSummary && !ratingSummarySaved) {
        const pageRatingSummary = await getRatingSummaryFromPageState(page);
        if (pageRatingSummary) {
            await Dataset.pushData({
                recordType: 'rating_summary',
                productId: sku,
                ratingSummary: pageRatingSummary,
            });
            ratingSummarySaved = true;
            log.info('Saved Noon rating summary from the product page.');
        } else {
            log.warning('Rating summary was requested, but Noon did not publish one for this page.');
        }
    }

    const summary = {
        productId: sku,
        locale: normalizedLocale,
        requestedTotal,
        savedTotal: totalSaved,
        apiReportedTotal: apiReportedTotal ?? null,
        stopReason,
        usedBrowserFetchFallback: useBrowserFallback,
        sessionWarmUpUsed,
        sessionRefreshRetried,
        ratingSummaryRequested: shouldIncludeRatingSummary,
        ratingSummarySaved,
        pageLoaded,
        interceptedApiUrl: interceptedApiUrl || null,
        interceptedInternalHeaders: Boolean(interceptedInternalHeaders),
        effectiveApiUrl: apiUrl,
        proxyCountryCode: desiredCountryCode,
    };
    await Actor.setValue('SUMMARY', summary);

    if (totalSaved === 0) {
        await Actor.setValue('RUN_DIAGNOSTICS', {
            ...summary,
            reason: 'No review records were returned by Noon after browser and JSON fallbacks.',
        });
        fatalError = new Error('No Noon reviews were extracted. See RUN_DIAGNOSTICS for safe troubleshooting details.');
    } else {
        log.info(`Extraction complete. Total saved: ${totalSaved}`);
    }
} catch (error) {
    fatalError = error;
} finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    if (fatalError) {
        const message = describeError(fatalError);
        log.error(`Run failed: ${message}`);
        await Actor.fail(message);
    }
    await Actor.exit();
}
