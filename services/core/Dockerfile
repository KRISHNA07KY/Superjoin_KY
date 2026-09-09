FROM rust:1-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY services/core ./services/core
COPY infra/db/migrations ./infra/db/migrations
WORKDIR /app/services/core
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# sqlx::migrate! embeds the migration SQL into the binary at compile time —
# nothing extra needed on disk at runtime.
COPY --from=build /app/services/core/target/release/groundwork-core ./groundwork-core
ENV UPLOAD_DIR=/app/data/documents
EXPOSE 8080
CMD ["./groundwork-core"]
