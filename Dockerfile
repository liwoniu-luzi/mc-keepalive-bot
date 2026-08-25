FROM node:20-alpine AS build

WORKDIR /usr/src
COPY package.json ./
RUN npm install --omit=dev

FROM scratch

# Node binary
COPY --from=build /usr/local/bin/node /usr/bin/node

# System libraries
COPY --from=build /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=build /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=build /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6

# Distribution configuration
COPY --from=build /etc/os-release /etc/os-release
COPY --from=build /etc/ssl/certs /etc/ssl/certs

# Application code
COPY --from=build /usr/src/node_modules /usr/src/node_modules
COPY package.json /usr/src/package.json
COPY bot.js /usr/src/bot.js
