FROM golang:1.22-bookworm AS build

WORKDIR /src
COPY main.go /src/main.go

RUN set -xe; \
    go build \
      -buildmode=pie \
      -ldflags "-linkmode external -extldflags -static-pie -s -w" \
      -tags netgo \
      -o /app \
      main.go

FROM scratch
COPY --from=build /app /app
EXPOSE 8080
ENTRYPOINT ["/app"]
