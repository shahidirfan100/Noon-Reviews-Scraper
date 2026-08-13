# Patchright-compatible image with Chrome runtime
FROM apify/actor-node-playwright-chrome:22

# Copy just package.json and package-lock.json first for caching
COPY --chown=myuser:myuser package*.json Dockerfile ./

# Install NPM packages (production only)
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Copy remaining source code
COPY --chown=myuser:myuser . ./

# Start the actor directly so application logs and uncaught errors are always
# forwarded to the Apify run log.
CMD ["node", "src/main.js"]
