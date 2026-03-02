import fs from 'node:fs';

const EXPECTED_PLAYWRIGHT_VERSION = '1.58.2';

const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const configuredVersion = packageJson.dependencies?.playwright;

if (!configuredVersion) {
    console.error('Missing playwright dependency in package.json.');
    process.exit(1);
}

if (configuredVersion !== EXPECTED_PLAYWRIGHT_VERSION) {
    console.error(
        `Playwright version mismatch. Expected "${EXPECTED_PLAYWRIGHT_VERSION}" but found "${configuredVersion}".`,
    );
    process.exit(1);
}

console.log(`Playwright version check passed: ${configuredVersion}`);
