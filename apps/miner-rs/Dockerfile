# syntax=docker/dockerfile:1
# Build stage pakai image rust penuh (bukan -slim): dependency `ring` butuh
# compiler C, dan image slim tidak membawanya.
FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/app/target cargo build --release --locked && cp target/release/nex-miner /usr/local/bin/nex-miner

FROM debian:bookworm-slim
# Miner tidak menulis file apa pun, jadi cukup user tanpa hak apa-apa.
COPY --from=build /usr/local/bin/nex-miner /usr/local/bin/nex-miner
USER 65534:65534
ENTRYPOINT ["nex-miner"]
