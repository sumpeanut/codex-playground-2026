FROM node:lts-alpine

# Install git and uv
RUN apk add --no-cache git uv npm
RUN npm install -g @github/copilot
RUN npm install -g @openai/codex
RUN uv tool install specify-cli --from git+https://github.com/github/spec-kit.git

# Set working directory
WORKDIR /usr/src/app

# Keep container running
CMD ["/bin/sh", "-c", "while sleep 1000; do :; done"]