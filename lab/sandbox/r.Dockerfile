# Sandbox for untrusted research code, runtime "r4.4". Same rules as python.Dockerfile.
FROM rocker/r-ver:4.4.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN install2.r --error --skipinstalled data.table jsonlite ggplot2 dplyr readr tidyr lme4 sandwich lmtest

RUN useradd --create-home --uid 1000 runner \
    && mkdir /work \
    && chown runner:runner /work

ENV R_LIBS_USER=/work/.rlib \
    HOME=/work/.home

USER runner
WORKDIR /work
