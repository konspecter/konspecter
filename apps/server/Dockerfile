# Konspecter server: a static binary on a minimal, non-root base image.
#   docker build -t konspecter-server apps/server/
#   docker run -e KONSPECTER_DATABASE_URL=postgres://… -p 8080:8080 konspecter-server
# The build runs on the build machine and cross-compiles for the target platform.
FROM --platform=$BUILDPLATFORM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=build /out/server /server
EXPOSE 8080
ENV KONSPECTER_ADDR=:8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
CMD ["serve"]
