import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { firefox } from 'playwright';

const API_URL = 'https://www.noon.com/_vs/mp/mp-trust-api/product-reviews/sku/list';
const PER_PAGE = 15;
const MAX_RESULTS_WANTED = 1000;
const MAX_HTTP_ATTEMPTS = 3;
const MAX_BROWSER_ATTEMPTS = 4;
const RETRYABLE_STATUS_CODES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_SORT_FILTERS = new Set(['helpful', 'newest', 'highest_rating', 'lowest_rating']);
const REVIEW_API_PATTERNS = [
    /\/product-reviews\/sku\/list/i,
    /mp-trust-api.*review/i,
    /\/reviews\/sku\//i,
];
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];

const pickUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

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

const sanitizeRequestHeaders = (headers) => {
    const blocked = new Set([
        'host',
        'content-length',
        'connection',
        'accept-encoding',
        'transfer-encoding',
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

const parseProxyForPlaywright = (proxyUrl) => {
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
    record.variantSku ?? '',
    record.author ?? '',
    record.title ?? '',
    record.reviewText ?? '',
    record.createdAt ?? record.date ?? '',
]);

await Actor.init();

let browser;
let context;
let page;

try {
    const input = (await Actor.getInput()) || {};
    const {
        productId,
        startUrl,
        results_wanted = 20,
        sortFilter = 'helpful',
        locale = 'en-ae',
        proxyConfiguration: proxyConfig,
    } = input;

    if (!productId && !startUrl) {
        throw new Error('You must provide either a productId or a startUrl.');
    }

    let sku = productId;
    if (!sku && startUrl) {
        const match = startUrl.match(/\/(N[A-Za-z0-9-]+)\/?/);
        if (!match) throw new Error(`Could not extract product ID from URL: ${startUrl}`);
        sku = match[1];
        log.info(`Extracted Product ID ${sku} from URL.`);
    }

    const requestedTotalRaw = Number(results_wanted);
    const requestedTotal = Number.isFinite(requestedTotalRaw) && requestedTotalRaw > 0
        ? Math.min(Math.floor(requestedTotalRaw), MAX_RESULTS_WANTED)
        : 20;
    const normalizedSortFilter = ALLOWED_SORT_FILTERS.has(sortFilter) ? sortFilter : 'helpful';
    if (normalizedSortFilter !== sortFilter) {
        log.warning(`Invalid sortFilter "${sortFilter}" provided. Falling back to "helpful".`);
    }
    const normalizedInputLocale = String(locale || 'en-ae').toLowerCase();
    const { lang, country, normalizedLocale, siteLocale } = parseLocale(normalizedInputLocale);
    const targetUrl = `https://www.noon.com/${siteLocale}/reviews/${sku}/`;

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
    const userAgent = pickUserAgent();
    let interceptedHeaders;
    let interceptedInternalHeaders;
    let interceptedPayloadTemplate;
    let interceptedApiUrl;
    let interceptedResponseData;

    log.info(`Starting Noon Reviews Fetcher for SKU: ${sku}`);
    log.info('Launching Firefox to obtain session and intercept network calls...');

    const launchBrowserAttempt = async (attempt) => {
        sessionProxyUrl = proxyConfiguration
            ? await proxyConfiguration.newUrl(`noon_reviews_${Date.now()}_${attempt}`)
            : undefined;
        const playwrightProxy = parseProxyForPlaywright(sessionProxyUrl);

        browser = await firefox.launch({
            headless: true,
            ...(playwrightProxy ? { proxy: playwrightProxy } : {}),
        });
        context = await browser.newContext({
            userAgent,
            viewport: { width: 1280, height: 720 },
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
                log.info(`Captured internal API headers from: ${request.url()}`);
            }
            if (request.method() === 'POST' && isReviewApiUrl(request.url())) {
                interceptedApiUrl = request.url();
                interceptedHeaders = sanitizeRequestHeaders(request.headers());
                const postData = request.postData();
                const parsedTemplate = typeof postData === 'string' ? safeJsonParse(postData) : null;
                if (parsedTemplate && typeof parsedTemplate === 'object') {
                    interceptedPayloadTemplate = parsedTemplate;
                }
            }
        });
        page.on('response', async (response) => {
            try {
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
            const pageResponse = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
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

            await page.waitForTimeout(9000);
            pageUrl = page.url() || targetUrl;
            pageLoaded = true;
            break;
        } catch (err) {
            log.warning(`Browser attempt ${attempt} failed: ${err.message}`);
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

    const triggerReviewTraffic = async () => {
        const clickSelectors = [
            'a[href*="/reviews/"]',
            '[data-qa*="review"]',
            '[data-testid*="review"]',
            'button:has-text("Reviews")',
            'button:has-text("reviews")',
        ];

        for (let i = 0; i < 3; i += 1) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(1200);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);

        for (const selector of clickSelectors) {
            try {
                const locator = page.locator(selector).first();
                if (await locator.count()) {
                    await locator.click({ timeout: 2000 });
                    await page.waitForTimeout(1800);
                }
            } catch {
                // Keep trying other selectors.
            }
        }
    };

    await triggerReviewTraffic();

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
                    headers,
                    json: payload,
                    timeout: { request: 30000 },
                });
                return { statusCode: response.statusCode, body: response.body };
            } catch (error) {
                const statusCode = error.response?.statusCode || 0;
                const body = error.response?.body || error.message;
                const shouldRetry = RETRYABLE_STATUS_CODES.has(statusCode) || statusCode === 0;

                if (!shouldRetry || attempt === MAX_HTTP_ATTEMPTS) {
                    return { statusCode, body };
                }

                const waitMs = attempt * 1500;
                log.warning(`HTTP request failed with ${statusCode} on attempt ${attempt}. Retrying in ${waitMs}ms.`);
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
    const savedReviewSignatures = new Set();

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
        if (interceptedItems.length > 0) {
            await pushUniqueReviews(interceptedItems, 'intercepted browser response');
            pageNumber = 2;
        }
    }

    while (totalSaved < requestedTotal) {
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

        const cookieHeader = await getCookieHeader();
        const baseHeaders = {
            accept: 'application/json, text/plain, */*',
            'accept-language': `${lang}-${country},${lang};q=0.9,en;q=0.8`,
            'content-type': 'application/json',
            origin: 'https://www.noon.com',
            referer: pageUrl,
            'user-agent': userAgent,
            'x-platform': 'web',
            'x-locale': normalizedLocale,
            'x-mp-country': country,
            'x-content': 'desktop',
            'x-cms': 'v2',
            ...(interceptedInternalHeaders || {}),
            ...(interceptedHeaders || {}),
            cookie: cookieHeader,
        };

        log.info(`API request for page ${pageNumber} (fetching ${requestedPerPage}, remaining ${requestedTotal - totalSaved}) using ${apiUrl}...`);

        let response = useBrowserFallback
            ? await fetchPageInBrowser({ apiUrl, payload, baseHeaders })
            : await fetchPageWithHttp({ apiUrl, payload, headers: baseHeaders });

        if (!useBrowserFallback && response.statusCode !== 200) {
            log.warning(`HTTP request blocked with ${response.statusCode}. Switching to browser-context fetch.`);
            useBrowserFallback = true;
            response = await fetchPageInBrowser({ apiUrl, payload, baseHeaders });
        }

        if (response.statusCode !== 200) {
            log.error(`API returned status ${response.statusCode}. Body: ${normalizeResponseBody(response.body).slice(0, 300)}`);
            break;
        }

        let data;
        try {
            const rawBody = normalizeResponseBody(response.body);
            data = JSON.parse(rawBody);
        } catch {
            log.error(`Invalid JSON on page ${pageNumber}. Body: ${normalizeResponseBody(response.body).slice(0, 300)}`);
            break;
        }

        const items = extractItemsFromApiData(data);
        if (!Array.isArray(items) || items.length === 0) {
            log.info('No more reviews returned. Stopping pagination.');
            break;
        }

        const savedNow = await pushUniqueReviews(items, 'API pagination');
        if (savedNow === 0) {
            duplicatePageStreak += 1;
            if (duplicatePageStreak >= 2) {
                log.info('Received duplicate-only pages twice in a row. Stopping pagination.');
                break;
            }
            log.info('Received duplicate-only page. Continuing to next page.');
            pageNumber += 1;
            continue;
        }
        duplicatePageStreak = 0;

        if (items.length < requestedPerPage) {
            log.info('Last page reached (returned less than requested perPage).');
            break;
        }
        const apiTotal = data?.total ?? data?.meta?.total ?? data?.pagination?.total;
        if (apiTotal != null && totalSaved >= apiTotal) {
            log.info(`All ${apiTotal} available reviews fetched.`);
            break;
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

    log.info(`Extraction complete. Total saved: ${totalSaved}`);
    await Actor.setValue('SUMMARY', {
        productId: sku,
        locale: normalizedLocale,
        requestedTotal,
        savedTotal: totalSaved,
        usedBrowserFetchFallback: useBrowserFallback,
        pageLoaded,
        interceptedApiUrl: interceptedApiUrl || null,
        interceptedInternalHeaders: Boolean(interceptedInternalHeaders),
        effectiveApiUrl: apiUrl,
        proxyCountryCode: desiredCountryCode,
    });
} finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    await Actor.exit();
}
