FROM golang:1.22-bookworm AS build

WORKDIR /src
COPY go.mod ./
COPY main.go ./

RUN set -xe; \
    go mod tidy && \
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
