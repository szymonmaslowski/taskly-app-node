FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

ARG CLAUDE_CODE_VERSION=2.1.314

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

RUN npm install --global --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

WORKDIR /workspace
ENTRYPOINT ["claude"]
