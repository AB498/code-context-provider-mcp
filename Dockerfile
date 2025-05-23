# Generated by https://smithery.ai. See: https://smithery.ai/docs/config#dockerfile
FROM node:lts-alpine

# Install dependencies without running prepare
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts

# Copy source and run setup to download WASM parsers
COPY . ./
RUN npm run setup

# Expose no ports (uses stdio)

# Default command to start the MCP server
CMD ["node", "index.js"]
