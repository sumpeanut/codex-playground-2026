FROM node:lts-alpine

# Install git and uv
RUN apk add --no-cache git uv npm
RUN npm install -g @github/copilot
RUN npm install -g @openai/codex
RUN uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
# Install git and openssh-client
RUN apk add --no-cache git openssh-client
# Create .ssh directory
RUN mkdir -p -m 0600 ~/.ssh
# Scan host keys (e.g., github.com) and add to known_hosts to prevent interactive prompt
RUN ssh-keyscan github.com >> ~/.ssh/known_hosts

# Set working directory
WORKDIR /usr/src/app

# Keep container running
CMD ["/bin/sh", "/usr/src/app/keep-alive.sh"]